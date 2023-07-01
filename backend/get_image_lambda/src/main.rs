use aws_sdk_dynamodb::{Client as DynamoDbClient};
use http::Method;
use log::{LevelFilter, info, error};
use chrono::Local;
use serde::Serialize;
use simple_logger::SimpleLogger;

use lambda_runtime::{service_fn, LambdaEvent};
use aws_lambda_events::event::apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse};
use aws_lambda_events::encodings::Body;

use lambda_utils::aws_sdk::ApiGatewayProxyResponseWithoutHeaders;

use get_image_lambda::get_already_set::get_already_set_object;

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    SimpleLogger::new()
        .with_level(LevelFilter::Info)
        .with_utc_timestamps()
        .init()
        .unwrap();

    let environment_variables = EnvironmentVariables::build();
    let aws_clients = AwsClients::build().await;

    lambda_runtime::run(service_fn(|request: LambdaEvent<ApiGatewayProxyRequest>| {
        handler(&environment_variables, &aws_clients, request.payload)
    })).await?;

    Ok(())
}

#[derive(Serialize)]
struct ResponseBody {
    url: String
}

async fn handler(
    environment_variables: &EnvironmentVariables, 
    aws_clients: &AwsClients, 
    req: ApiGatewayProxyRequest
) -> Result<ApiGatewayProxyResponse, lambda_runtime::Error> {
    info!("handling a request: {:?}", req);

    let dynamodb_client = &aws_clients.dynamodb_client;

    if req.http_method != Method::GET {
        panic!("Only handle GET requests should not receive any other request type");
    }

    let today_as_string = Local::now()
        .format("%Y-%m-%d")
        .to_string();

    info!("Today is {}", today_as_string);

    let set_object_key = match get_already_set_object(
            &environment_variables.table_name, 
            &environment_variables.table_primary_key,
            &today_as_string, dynamodb_client
        ).await {
            Ok(output) => Ok(output),
            Err(err) => {
                error!("Object is not already set for today {} for reason {:?}", today_as_string, err);
                Err(ApiGatewayProxyResponseWithoutHeaders {
                    status_code: 500, 
                    body: Body::Text(format!("Failed to get random object for the day: {:?}", err)), 
                    is_base_64_encoded: false
                }.build_full_response())
            }
        };
    
    match set_object_key {
        Ok(set_object) => {
            info!("The currently set object is: {:?}", set_object);

            let response_body = ResponseBody {
                url: format!("https://{}/{}", environment_variables.image_domain, set_object)
            };

            let response = serde_json::to_string(&response_body)?;

            Ok(ApiGatewayProxyResponseWithoutHeaders {
                status_code: 200,
                body: Body::Text(response),
                is_base_64_encoded: false
            }.build_full_response())
        },
        Err(api_gateway_response) => Ok(api_gateway_response)
    }
}
struct AwsClients {
    dynamodb_client: DynamoDbClient
}

impl AwsClients {
    async fn build() -> AwsClients {
        // No extra configuration is needed as long as your Lambda has
        // the necessary permissions attached to its role.
        let config = aws_config::load_from_env().await;

        let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);

        AwsClients {
            dynamodb_client
        }
    }
}

struct EnvironmentVariables {
    image_domain: String,
    table_name: String,
    table_primary_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let image_domain = std::env::var("IMAGE_DOMAIN")
            .expect("A IMAGE_DOMAIN must be set in this app's Lambda environment variables.");
        let table_name = std::env::var("TABLE_NAME")
            .expect("A TABLE_NAME must be set in this app's Lambda environment variables.");
        let table_primary_key = std::env::var("TABLE_PRIMARY_KEY")
            .expect("A TABLE_PRIMARY_KEY must be set in this app's Lambda environment varialbes.");

        EnvironmentVariables { 
            image_domain,
            table_name, 
            table_primary_key 
        }
    }
}