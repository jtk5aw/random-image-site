use std::collections::HashMap;

use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use chrono::Local;
use lambda_utils::{
    aws_sdk::api_gateway::{ApiGatewayProxyResponseWithoutHeaders, extract_body_from_request},
    models::{ReactionError, Reactions, SstTable},
    persistence::user_reaction_dao::{UserReactionDao, UserReactionDaoError},
};
use log::{error, info, LevelFilter};
use serde::{Deserialize, Serialize};
use serde_json::Error as SerdeJsonError;
use simple_logger::SimpleLogger;

use aws_lambda_events::{
    encodings::Body,
    event::apigw::{ApiGatewayV2httpRequest, ApiGatewayV2httpResponse},
    http::Method,
};
use lambda_runtime::{service_fn, LambdaEvent};
use sst_sdk::Resource;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    SimpleLogger::new()
        .with_level(LevelFilter::Info)
        .with_utc_timestamps()
        .init()
        .unwrap();

    let environment_variables = EnvironmentVariables::build();
    let aws_clients = AwsClients::build().await;

    lambda_runtime::run(service_fn(
        |request: LambdaEvent<ApiGatewayV2httpRequest>| {
            handler(&environment_variables, &aws_clients, request.payload)
        },
    ))
    .await?;

    Ok(())
}

const HARDCODED_PREFIX: &str = "discord";

// Wrapper on GetHandlerError and PutHandlerError
#[derive(Debug)]
pub enum HandlerError {
    PutError(PutHandlerError),
    GetError(GetHandlerError),
}

async fn handler(
    environment_variables: &EnvironmentVariables,
    aws_clients: &AwsClients,
    req: ApiGatewayV2httpRequest,
) -> Result<ApiGatewayV2httpResponse, lambda_runtime::Error> {
    info!("handling a request: {:?}", req);

    let user_reaction_dao = UserReactionDao {
        table_name: &environment_variables.table_name,
        primary_key: &environment_variables.table_primary_key,
        sort_key: &environment_variables.table_sort_key,
        dynamodb_client: &aws_clients.dynamodb_client,
    };

    let today_as_string = Local::now().format("%Y-%m-%d").to_string();

    info!("Today is {}", today_as_string);

    // TODO: Break up these get and put functions into their own library files like is done for get-image-lambda
    //  Also just consider making one get_metadata_lambda and then a seperate set_reaction_lambda
    //  I think with the current direction of the API that makes more sense

    let result: Result<ApiGatewayV2httpResponse, HandlerError> =
        match req.request_context.http.method {
            Method::GET => handler_get(req, &today_as_string, user_reaction_dao)
                .await
                .map_err(HandlerError::GetError),
            Method::PUT => handler_put(req, &today_as_string, user_reaction_dao)
                .await
                .map_err(HandlerError::PutError),
            _ => {
                panic!("Only handle GET or PUT requests should not receive any other request type")
            }
        };

    Ok(result.unwrap_or_else(|err| {
        error!(
            "Failed to properly handle the incoming request due to {:?}",
            err
        );
        ApiGatewayProxyResponseWithoutHeaders {
            status_code: 500,
            body: Body::Text(format!("Failed to process the request: {:?}", err)),
            is_base_64_encoded: false,
        }
        .build_v2_response()
    }))
}

// Body of the response for both GET
#[derive(Serialize, Deserialize, Debug)]
struct GetResponseBody {
    uuid: String,
    reaction: String,
    favorite_image: String,
    counts: HashMap<String, String>,
}

// Error enum for GET
#[derive(Debug)]
pub enum GetHandlerError {
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

async fn handler_get(
    req: ApiGatewayV2httpRequest,
    today_as_string: &str,
    user_reaction_dao: UserReactionDao<'_>,
) -> Result<ApiGatewayV2httpResponse, GetHandlerError> {
    let curr_uuid = req
        .query_string_parameters
        .first("uuid")
        .map_or(Uuid::new_v4().to_string(), |uuid| uuid.to_owned());

    // Get the current user items
    let user_items = user_reaction_dao
        .get(HARDCODED_PREFIX, today_as_string, &curr_uuid)
        .await;

    // Get the current state of all reaction counts
    let numeric_counts = user_reaction_dao
        .get_counts(HARDCODED_PREFIX, today_as_string)
        .await
        .unwrap_or_default();

    let response_body = GetResponseBody {
        uuid: curr_uuid,
        reaction: user_items.reaction,
        favorite_image: user_items.favorite_image,
        counts: numeric_counts,
    };

    let response = serde_json::to_string(&response_body)?;

    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200,
        body: Body::Text(response),
        is_base_64_encoded: false,
    }
    .build_v2_response())
}

// Body of the response for the PUT
#[derive(Serialize, Deserialize, Debug)]
struct PutResponseBody {
    uuid: String,
    reaction: String,
    counts: HashMap<String, String>,
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
    ReactionError(ReactionError),
    UserReactionDaoError(UserReactionDaoError),
    LocalError(String),
}

impl From<SerdeJsonError> for PutHandlerError {
    fn from(err: SerdeJsonError) -> Self {
        Self::SerdeParseError(err)
    }
}

impl From<ReactionError> for PutHandlerError {
    fn from(err: ReactionError) -> Self {
        Self::ReactionError(err)
    }
}

impl From<UserReactionDaoError> for PutHandlerError {
    fn from(err: UserReactionDaoError) -> Self {
        Self::UserReactionDaoError(err)
    }
}

impl From<String> for PutHandlerError {
    fn from(err: String) -> Self {
        Self::LocalError(err)
    }
}

async fn handler_put(
    req: ApiGatewayV2httpRequest,
    today_as_string: &str,
    user_reaction_dao: UserReactionDao<'_>,
) -> Result<ApiGatewayV2httpResponse, PutHandlerError> {
    let body_as_str = extract_body_from_request(&req)
        .map_err(PutHandlerError::LocalError)?;

    info!("body_as_str: {:?}", body_as_str);
    let body: RequestBody = serde_json::from_str(&body_as_str)?;

    info!("body_as_str: {}, body: {:?}", body_as_str, body);

    let uuid = &body.uuid;
    let reaction = Reactions::get_reaction(&body.reaction)?;

    // Set the reaction
    let old_reaction = user_reaction_dao
        .set_reaction(HARDCODED_PREFIX, today_as_string, uuid, &reaction)
        .await?;

    info!(
        "Request to update reaction completed. The old reaction was {}",
        old_reaction
    );

    // Make request to update/get the counts
    let numeric_counts = user_reaction_dao
        .update_counts(HARDCODED_PREFIX, today_as_string, &old_reaction, &reaction)
        .await?;

    info!("The counts are: {:?}", numeric_counts);

    let response_body = PutResponseBody {
        reaction: reaction.to_string(),
        uuid: uuid.to_owned(),
        counts: numeric_counts,
    };

    let response = serde_json::to_string(&response_body)?;

    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200,
        body: Body::Text(response),
        is_base_64_encoded: false,
    }
    .build_v2_response())
}

struct AwsClients {
    dynamodb_client: DynamoDbClient,
}

impl AwsClients {
    async fn build() -> AwsClients {
        // No extra configuration is needed as long as your Lambda has
        // the necessary permissions attached to its role.
        let config = aws_config::load_defaults(BehaviorVersion::latest()).await;

        let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);

        AwsClients { dynamodb_client }
    }
}

/** Environment Variables */
struct EnvironmentVariables {
    table_name: String,
    table_primary_key: String,
    table_sort_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let resource = Resource::init().expect("Should be able to initialize SST resource");
        let table: SstTable = resource
            .get("ImageTable")
            .expect("Should be able t get ImageTable");

        EnvironmentVariables {
            table_name: table.name,
            table_primary_key: table.primary_key,
            table_sort_key: table.sort_key,
        }
    }
}

