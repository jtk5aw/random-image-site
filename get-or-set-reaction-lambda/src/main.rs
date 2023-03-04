use std::{fmt, str::FromStr};

use aws_sdk_dynamodb::{Client as DynamoDbClient, model::{AttributeValue, ReturnValue}, error::UpdateItemError, types::SdkError as DynamoDbSdkError};
use http::Method;
use lambda_utils::{ApiGatewayProxyResponseWithoutHeaders, DynamoDbUtil, DynamoDbUtilError};
use log::{LevelFilter, info, error};
use chrono::Local;
use serde::{Serialize, Deserialize};
use serde_json::Error as SerdeJsonError;
use simple_logger::SimpleLogger;

use lambda_runtime::handler_fn;
use aws_lambda_events::{event::apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse}, encodings::Body};
use strum::ParseError;
use strum_macros::EnumString;


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
    GetError(GetHandlerError)
}

async fn handler(req: ApiGatewayProxyRequest, _ctx: lambda_runtime::Context) -> Result<ApiGatewayProxyResponse, lambda_runtime::Error> {
    info!("handling a request: {:?}", req);

    let environment_variables = EnvironmentVariables::build();

    // No extra configuration is needed as long as your Lambda has
    // the necessary permissions attached to its role.
    let config = aws_config::load_from_env().await;

    let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);

    let today_as_string = Local::now()
        .format("%Y-%m-%d")
        .to_string();

    info!("Today is {}", today_as_string);

    let result: Result<ApiGatewayProxyResponse, HandlerError> = match req.http_method { 
        Method::GET => handler_get(
                &today_as_string, 
                &environment_variables.table_name,
                &environment_variables.table_primary_key, 
                dynamodb_client
            ).await
            .map_err( HandlerError::GetError),
        Method::PUT => handler_put(
                req, 
                &today_as_string, 
                &environment_variables.table_name, 
                &environment_variables.table_primary_key,
                dynamodb_client
            ).await
            .map_err(HandlerError::PutError),
        _ => panic!("Only handle GET or PUT requests should not receive any other request type")
    };

    Ok(result
        .map_or_else(|err| {
            error!("Failed to properly handle the incoming request due to {:?}", err);
            ApiGatewayProxyResponseWithoutHeaders {
                status_code: 500,
                body: Body::Text(format!("Failed to process the request: {:?}", err)),
                is_base_64_encoded: false
            }.build_full_response()
        }, |ok| ok))
}

// Reactions Enum that can be converted into strings
#[derive(Debug, EnumString)]
pub enum Reactions {
    NoReaction,
    Funny, 
    Love,
    Eesh,
    Pain
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
    LocalError(String)
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
    today_as_string: &str,
    table_name: &str,
    table_primary_key: &str,
    dynamodb_client: DynamoDbClient
) -> Result<ApiGatewayProxyResponse, GetHandlerError> {

    let item = dynamodb_client.get_item_from_key(
        table_name, 
        table_primary_key, 
        today_as_string.to_owned()
    ).await?;

    let reaction_string = item
        .get("reaction")
        .map_or(Reactions::NoReaction.to_string(), |reaction_val| {
            reaction_val
                .as_s()
                .map_or(
                    Reactions::NoReaction.to_string(), 
                    |result| result.to_owned())
        });
    
    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200,
        body: Body::Text(reaction_string),
        is_base_64_encoded: false
    }.build_full_response())
}

// Body of the request to be recevied
#[derive(Serialize, Deserialize, Debug)]
struct RequestBody {
    reaction: String,
}

// Error enum for PUT
#[derive(Debug)]
pub enum PutHandlerError {
    SerdeParseError(SerdeJsonError),
    EnumStrParseError(ParseError),
    UpdateItemError(Box<DynamoDbSdkError<UpdateItemError>>),
    AttributeValueConversionFailure(AttributeValue),
    LocalError(String)
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

impl From<DynamoDbSdkError<UpdateItemError>> for PutHandlerError {
    fn from(err: DynamoDbSdkError<UpdateItemError>) -> Self {
        Self::UpdateItemError(Box::new(err))
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
    table_name: &str, 
    table_primary_key: &str,
    dynamodb_client: DynamoDbClient
) -> Result<ApiGatewayProxyResponse, PutHandlerError> {
    let body_as_str = req.body.ok_or_else(|| "Body does not exist".to_owned())?;

    let body: RequestBody = serde_json::from_str(&body_as_str)?;

    info!("body_as_str: {}, body: {:?}", body_as_str, body);

    let reaction = Reactions::from_str(&body.reaction)?;

    let update_item_result = dynamodb_client
        .update_item()
        .table_name(table_name)
        .key(table_primary_key, AttributeValue::S(today_as_string.to_owned()))
        .update_expression("SET reaction = :new_reaction")
        .expression_attribute_values(":new_reaction", AttributeValue::S(reaction.to_string()))
        .return_values(ReturnValue::AllNew)
        .send()
        .await?;

    let reaction_attribute = update_item_result
        .attributes()
        .ok_or_else(|| "No returned attribute values. Reaction may not have been written".to_owned())?
        .get("reaction")
        .ok_or_else(|| "Did not successfully write reaction".to_owned())?
        .as_s()
        .map_err(|err| err.to_owned())?;

    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200, 
        body: Body::Text(format!("Successfully wrote reaction as {}", reaction_attribute)),
        is_base_64_encoded: false
    }.build_full_response())
}

struct EnvironmentVariables {
    table_name: String,
    table_primary_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let table_name = std::env::var("TABLE_NAME")
            .expect("A TABLE_NAME must be set in this app's Lambda environment variables.");
        let table_primary_key = std::env::var("TABLE_PRIMARY_KEY")
            .expect("A TABLE_PRIMARY_KEY must be setn this app's Lambda environment varialbes.");

        EnvironmentVariables { 
            table_name, 
            table_primary_key 
        }
    }
}