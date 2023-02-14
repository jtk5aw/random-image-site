use aws_sdk_dynamodb::{Client as DynamoDbClient};
use http::Method;
use lambda_utils::ApiGatewayProxyResponseWithoutHeaders;
use log::{LevelFilter, info};
use chrono::Local;
use serde::{Serialize, Deserialize};
use simple_logger::SimpleLogger;

use lambda_runtime::handler_fn;
use aws_lambda_events::{event::apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse}, encodings::Body};


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

    let result = match req.http_method { 
        Method::GET => handler_get(req, &today_as_string, dynamodb_client).await?,
        Method::PUT => handler_put(req, &today_as_string, dynamodb_client).await?,
        _ => panic!("Only handle GET or PUT requests should not receive any other request type")
    };

    return Ok(result)
}

async fn handler_get(req: ApiGatewayProxyRequest, today_as_string: &str, dynamodb_client: DynamoDbClient) -> Result<ApiGatewayProxyResponse, lambda_runtime::Error> {
    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200,
        body: Body::Text("This is a test result".to_owned()),
        is_base_64_encoded: false
    }.build_full_response())
}

async fn handler_put(req: ApiGatewayProxyRequest, today_as_string: &str, dynamodb_client: DynamoDbClient) -> Result<ApiGatewayProxyResponse, lambda_runtime::Error> {
    let body_as_str = req.body.ok_or("Body does not exist".to_owned())?;

    let body: RequestBody = serde_json::from_str(&body_as_str)?;

    info!("body_as_str: {}, body: {:?}", body_as_str, body);

    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200, 
        body: Body::Text("This is a test result".to_owned()),
        is_base_64_encoded: false
    }.build_full_response())
}

#[derive(Serialize, Deserialize, Debug)]
struct RequestBody {
    reaction: String,
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