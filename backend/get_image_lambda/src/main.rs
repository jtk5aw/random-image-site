use http::Method;
use log::{LevelFilter, info, error};
use chrono::Local;
use simple_logger::SimpleLogger;

use lambda_runtime::handler_fn;
use aws_lambda_events::event::apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse};
use aws_lambda_events::encodings::Body;

use lambda_utils::aws_sdk::ApiGatewayProxyResponseWithoutHeaders;

use get_image_lambda::get_already_set::get_already_set_object;
use get_image_lambda::select_and_set::select_and_set_random_s3_object;

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

    if req.http_method != Method::GET {
        panic!("Only handle GET requests should not receive any other request type");
    }

    let environment_variables = EnvironmentVariables::build();

    // No extra configuration is needed as long as your Lambda has
    // the necessary permissions attached to its role.
    let config = aws_config::load_from_env().await;

    let s3_client = aws_sdk_s3::Client::new(&config);
    let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);

    let today_as_string = Local::now()
        .format("%Y-%m-%d")
        .to_string();

    info!("Today is {}", today_as_string);

    let set_object_result = match get_already_set_object(
            &environment_variables.bucket_name, &environment_variables.table_name, &environment_variables.table_primary_key,
            &today_as_string, &dynamodb_client, &s3_client
        ).await {
            Ok(output) => Ok(output),
            Err(err) => {
                info!("Object is not already set for today {} for reason {:?}", today_as_string, err);
                select_and_set_random_s3_object(&environment_variables.bucket_name, &environment_variables.table_name, &environment_variables.table_primary_key, 
                        &today_as_string, &dynamodb_client, &s3_client)
                    .await
                    .map_err(|err| {
                        error!("Failed to get a random object from the bucket due to the following: {:?}", err);
                        ApiGatewayProxyResponseWithoutHeaders {
                            status_code: 500, 
                            body: Body::Text(format!("Failed to get random object: {:?}", err)), 
                            is_base_64_encoded: false
                        }.build_full_response()
                    })
            }
        };
    
    match set_object_result {
        Ok(set_object) => {
            info!("The currently set object is: {:?}", set_object);

            Ok(set_object
                .body
                .collect()
                .await
                .map_or_else(|err| {
                    error!("Failed to read the entire s3 objects body due to {}", err);
                    ApiGatewayProxyResponseWithoutHeaders {
                        status_code: 500, 
                        body: Body::Text(format!("Failed to read the entire s3 objects body due to: {:?}", err)), 
                        is_base_64_encoded: false
                    }.build_full_response()
                }, |aggregated_bytes| {
                    ApiGatewayProxyResponseWithoutHeaders {
                        status_code: 200, 
                        body: Body::Text(base64::encode(aggregated_bytes.into_bytes())), 
                        is_base_64_encoded: true
                    }.build_full_response()
                }))
        },
        Err(api_gateway_response) => Ok(api_gateway_response)
    }
}

struct EnvironmentVariables {
    bucket_name: String,
    table_name: String,
    table_primary_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let bucket_name = std::env::var("BUCKET_NAME")
            .expect("A BUCKET_NAME must be set in this app's Lambda environment variables.");
        let table_name = std::env::var("TABLE_NAME")
            .expect("A TABLE_NAME must be set in this app's Lambda environment variables.");
        let table_primary_key = std::env::var("TABLE_PRIMARY_KEY")
            .expect("A TABLE_PRIMARY_KEY must be set in this app's Lambda environment varialbes.");

        EnvironmentVariables { 
            bucket_name, 
            table_name, 
            table_primary_key 
        }
    }
}