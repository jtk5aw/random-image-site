use std::{fmt, str::FromStr, collections::HashMap};

use aws_sdk_dynamodb::{
    model::{AttributeValue, ReturnValue},
    Client as DynamoDbClient,
};
use chrono::Local;
use http::Method;
use lambda_utils::{
    ApiGatewayProxyResponseWithoutHeaders, DynamoDbUtil, DynamoDbUtilError, KeyAndAttribute,
    KeyAndAttributeName,
};
use log::{error, info, warn, LevelFilter};
use serde::{Deserialize, Serialize};
use serde_json::Error as SerdeJsonError;
use simple_logger::SimpleLogger;

use aws_lambda_events::{
    encodings::Body,
    event::apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse},
};
use lambda_runtime::handler_fn;
use strum::{ParseError, IntoEnumIterator};
use strum_macros::{EnumString, EnumIter};
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    SimpleLogger::new()
        .with_level(LevelFilter::Info)
        .with_utc_timestamps()
        .init()
        .unwrap();

    let func = handler_fn(handler);
    lambda_runtime::run(func).await?;

    Ok(())
}

// Wrapper on GetHandlerError and PutHandlerError
#[derive(Debug)]
pub enum HandlerError {
    PutError(PutHandlerError),
    GetError(GetHandlerError),
}

async fn handler(
    req: ApiGatewayProxyRequest,
    _ctx: lambda_runtime::Context,
) -> Result<ApiGatewayProxyResponse, lambda_runtime::Error> {
    info!("handling a request: {:?}", req);

    let environment_variables = EnvironmentVariables::build();

    // No extra configuration is needed as long as your Lambda has
    // the necessary permissions attached to its role.
    let config = aws_config::load_from_env().await;

    let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);

    let today_as_string = Local::now().format("%Y-%m-%d").to_string();

    info!("Today is {}", today_as_string);

    // TODO: Break up these geta nd put functions into their own library files like is done for get-image-lambda

    let result: Result<ApiGatewayProxyResponse, HandlerError> = match req.http_method {
        Method::GET => handler_get(
            req,
            &today_as_string,
            &environment_variables.user_reaction_table_name,
            &environment_variables.user_reaction_table_primary_key,
            &environment_variables.user_reaction_table_sort_key,
            dynamodb_client,
        )
        .await
        .map_err(HandlerError::GetError),
        Method::PUT => handler_put(
            req,
            &today_as_string,
            &environment_variables.user_reaction_table_name,
            &environment_variables.user_reaction_table_primary_key,
            &environment_variables.user_reaction_table_sort_key,
            dynamodb_client,
        )
        .await
        .map_err(HandlerError::PutError),
        _ => panic!("Only handle GET or PUT requests should not receive any other request type"),
    };

    Ok(result.map_or_else(
        |err| {
            error!(
                "Failed to properly handle the incoming request due to {:?}",
                err
            );
            ApiGatewayProxyResponseWithoutHeaders {
                status_code: 500,
                body: Body::Text(format!("Failed to process the request: {:?}", err)),
                is_base_64_encoded: false,
            }
            .build_full_response()
        },
        |ok| ok,
    ))
}

// Body of the response for both GET and PUT
#[derive(Serialize, Deserialize, Debug)]
struct ResponseBody {
    uuid: String,
    reaction: String,
    counts: HashMap<String, String>
}

// Reactions Enum that can be converted into strings
#[derive(Debug, EnumString, EnumIter)]
pub enum Reactions {
    NoReaction,
    Funny,
    Love,
    Eesh,
    Pain,
}

impl fmt::Display for Reactions {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

// Error enum for GET
#[derive(Debug)]
pub enum GetHandlerError {
    GetItemFromKeyFailure(DynamoDbUtilError),
    SerdeToStringError(SerdeJsonError),
    LocalError(String),
}

impl From<SerdeJsonError> for GetHandlerError {
    fn from(err: SerdeJsonError) -> Self {
        Self::SerdeToStringError(err)
    }
}

impl From<String> for GetHandlerError {
    fn from(err: String) -> Self {
        Self::LocalError(err)
    }
}

impl From<DynamoDbUtilError> for GetHandlerError {
    fn from(err: DynamoDbUtilError) -> Self {
        Self::GetItemFromKeyFailure(err)
    }
}

async fn handler_get(
    req: ApiGatewayProxyRequest,
    today_as_string: &str,
    user_reaction_table_name: &str,
    user_reaction_primary_key: &str,
    user_reaction_sort_key: &str,
    dynamodb_client: DynamoDbClient,
) -> Result<ApiGatewayProxyResponse, GetHandlerError> {
    let curr_uuid = req
        .query_string_parameters
        .get("uuid")
        .map_or(Uuid::new_v4().to_string(), |uuid| uuid.to_owned());

    let keys_and_attributes = build_user_reaction_key_and_attribute(
        user_reaction_primary_key,
        user_reaction_sort_key,
        today_as_string,
        &curr_uuid,
    );

    let get_item_from_key_result = dynamodb_client
        .get_item_from_keys(user_reaction_table_name, keys_and_attributes)
        .await
        .ok();

    let reaction_string = match get_item_from_key_result {
        Some(dynamo_map) => {
            dynamo_map
                .get("reaction")
                .map_or(Reactions::NoReaction.to_string(), |reaction_val| {
                    reaction_val
                        .as_s()
                        .map_or(Reactions::NoReaction.to_string(), |result| {
                            result.to_owned()
                        })
                })
        }
        None => Reactions::NoReaction.to_string(),
    };

    let response_body = ResponseBody {
        uuid: curr_uuid,
        reaction: reaction_string,
        counts: HashMap::default()
    };

    let response = serde_json::to_string(&response_body)?;

    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200,
        body: Body::Text(response),
        is_base_64_encoded: false,
    }
    .build_full_response())
}

// Body of the request to be recevied
#[derive(Serialize, Deserialize, Debug)]
struct RequestBody {
    uuid: String,
    reaction: String,
}

// Error enum for PUT
#[derive(Debug)]
pub enum PutHandlerError {
    SerdeParseError(SerdeJsonError),
    EnumStrParseError(ParseError),
    UpdateItemError(DynamoDbUtilError),
    AttributeValueConversionFailure(AttributeValue),
    LocalError(String),
}

impl From<SerdeJsonError> for PutHandlerError {
    fn from(err: SerdeJsonError) -> Self {
        Self::SerdeParseError(err)
    }
}

impl From<ParseError> for PutHandlerError {
    fn from(err: ParseError) -> Self {
        Self::EnumStrParseError(err)
    }
}

impl From<DynamoDbUtilError> for PutHandlerError {
    fn from(err: DynamoDbUtilError) -> Self {
        Self::UpdateItemError(err)
    }
}

impl From<AttributeValue> for PutHandlerError {
    fn from(err: AttributeValue) -> Self {
        Self::AttributeValueConversionFailure(err)
    }
}

impl From<String> for PutHandlerError {
    fn from(err: String) -> Self {
        Self::LocalError(err)
    }
}

async fn handler_put(
    req: ApiGatewayProxyRequest,
    today_as_string: &str,
    user_reaction_table_name: &str,
    user_reaction_primary_key: &str,
    user_reaction_sort_key: &str,
    dynamodb_client: DynamoDbClient,
) -> Result<ApiGatewayProxyResponse, PutHandlerError> {
    let body_as_str = req.body.ok_or_else(|| "Body does not exist".to_owned())?;

    let body: RequestBody = serde_json::from_str(&body_as_str)?;

    info!("body_as_str: {}, body: {:?}", body_as_str, body);

    let uuid = &body.uuid;
    let reaction = Reactions::from_str(&body.reaction)?;
    let reaction_string = reaction.to_string();

    let keys_and_attributes = build_user_reaction_key_and_attribute(
        user_reaction_primary_key,
        user_reaction_sort_key,
        today_as_string,
        uuid,
    );

    let expression_attribute_values = vec![KeyAndAttribute {
        key: ":new_reaction",
        attribute: AttributeValue::S(reaction_string.to_owned()),
    }];

    // Updates the reaction
    // Gets the old reaction. This allows for decrementing the old reaction count
    let update_reaction_result = dynamodb_client
        .update_item_with_keys(
            user_reaction_table_name,
            keys_and_attributes,
            "SET reaction = :new_reaction".to_owned(),
            ReturnValue::AllOld,
            None,
            expression_attribute_values,
        )
        .await;

    
    let old_reaction = match update_reaction_result { 
        Ok(result) => handle_old_reaction_success(result), 
        Err(err) => handle_old_reaction_error(err)
    }?;

    info!("Request to update reaction completed");

    info!("The old reaction was {}", old_reaction);

    // Make request to set up counts 
    // TODO: Move this to the select_and_set
    let counts_keys_and_attributes = build_user_reaction_key_and_attribute(
        user_reaction_primary_key,
        user_reaction_sort_key,
        today_as_string,
        "ReactionCounts",
    );

    let starting_counts_map = build_starting_counts();

    let counts_setup_attribute_values = vec![
        KeyAndAttribute {
            key: ":counts_map",
            attribute: AttributeValue::M(starting_counts_map)
        }
    ];

    let update_counts_result = dynamodb_client.update_item_with_keys(
        user_reaction_table_name,
        counts_keys_and_attributes,
        "SET Counts = if_not_exists(Counts, :counts_map)".to_owned(),
        ReturnValue::AllNew,
        None,
        counts_setup_attribute_values

    ).await?;

    // Make request to update the counts
    let counts_keys_and_attributes = build_user_reaction_key_and_attribute(
        user_reaction_primary_key,
        user_reaction_sort_key,
        today_as_string,
        "ReactionCounts",
    );

    let counts_expression_attribute_names = Some(vec![
        KeyAndAttributeName {
            key: "#new_reaction",
            attribute_name: &reaction_string,
        },
        KeyAndAttributeName {
            key: "#old_reaction",
            attribute_name: &old_reaction,
        },
    ]);

    let counts_expression_attribute_values = vec![
        KeyAndAttribute {
            key: ":count",
            attribute: AttributeValue::N("1".to_owned()),
        }
    ];
    
    // TODO: If the same reaction is used twice in a row that will cause issues
    let update_counts_result = dynamodb_client.update_item_with_keys(
        user_reaction_table_name,
        counts_keys_and_attributes,
        "SET Counts.#new_reaction = Counts.#new_reaction + :count , Counts.#old_reaction = Counts.#old_reaction - :count".to_owned(),
        ReturnValue::AllNew,
        counts_expression_attribute_names,
        counts_expression_attribute_values

    ).await?;

    info!("Request to update counts completed");

    let updated_counts = update_counts_result
        .get("Counts")
        .ok_or_else(|| "Did not successfully update counts".to_owned())?
        .as_m()
        .ok();

    // Default to 0 on any error
    let mut numeric_counts: HashMap<String, String> = HashMap::default();
    if let Some(counts) = updated_counts {
        for (key, value) in counts {
            let count = value
                .as_n()
                .map_or(
                    "0".to_owned(), 
                    |val| val.to_owned()
                );
            numeric_counts.insert(key.to_owned(), count);
        }
    }

    info!("The counts are: {:?}", numeric_counts);

    let response_body = ResponseBody {
        reaction: reaction.to_string(),
        uuid: uuid.to_owned(),
        counts: numeric_counts
    };

    let response = serde_json::to_string(&response_body)?;

    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200,
        body: Body::Text(response),
        is_base_64_encoded: false,
    }
    .build_full_response())
}

/** Helper functions for put handler */
fn handle_old_reaction_success(
    result: HashMap<String, AttributeValue>
) -> Result<String, PutHandlerError> {
    info!("Request to update reaction completed successfully");

    let reaction = result
        .get("reaction")
        .ok_or_else(|| "Did not successfully write reaction".to_owned())?
        .as_s()
        .map_err(|err| err.to_owned())?;

    Ok(reaction.to_owned())
}

fn handle_old_reaction_error(
    err: DynamoDbUtilError
) -> Result<String, PutHandlerError> {
    warn!("There was an error attempting to update the reaction");

    if let DynamoDbUtilError::LocalError(_) = err {
        info!("Error only caused because this was the first reaction. Continuing");

        return Ok(Reactions::NoReaction.to_string())
    }

    error!("Error was a failure to update the previous reaction");
    Err(PutHandlerError::UpdateItemError(err))
}

fn build_starting_counts() -> HashMap<String, AttributeValue> {

    let mut starting_counts = HashMap::new();
    for reaction in Reactions::iter() {
        starting_counts.insert(reaction.to_string(), AttributeValue::N("0".to_owned()));
    };
    return starting_counts
}

/** Utilities */
fn build_user_reaction_key_and_attribute<'a>(
    primary_key: &'a str,
    sort_key: &'a str,
    today_as_string: &str,
    user: &str,
) -> Vec<KeyAndAttribute<'a>> {
    vec![
        KeyAndAttribute {
            key: primary_key,
            attribute: AttributeValue::S(today_as_string.to_owned()),
        },
        KeyAndAttribute {
            key: sort_key,
            attribute: AttributeValue::S(user.to_owned()),
        },
    ]
}

/** Environment Variables */
struct EnvironmentVariables {
    user_reaction_table_name: String,
    user_reaction_table_primary_key: String,
    user_reaction_table_sort_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let user_reaction_table_name = std::env::var("USER_REACTION_TABLE_NAME")
            .expect("A USER_REACTION_TABLE_NAME must be provided");
        let user_reaction_table_primary_key = std::env::var("USER_REACTION_TABLE_PRIMARY_KEY")
            .expect("A USER_REACTION_TABLE_PRIMARY_KEY must be provided");
        let user_reaction_table_sort_key = std::env::var("USER_REACTION_TABLE_SORT_KEY")
            .expect("A USER_REACTION_TABLE_SORT_KEY must be provided");

        EnvironmentVariables {
            user_reaction_table_name,
            user_reaction_table_primary_key,
            user_reaction_table_sort_key,
        }
    }
}
