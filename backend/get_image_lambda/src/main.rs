use aws_config::BehaviorVersion;
use aws_lambda_events::http::Method;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use chrono::Local;
use lambda_utils::persistence::image_dynamo_dao::ImageDynamoDao;
use serde::Serialize;

use aws_lambda_events::encodings::Body;
use aws_lambda_events::event::apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse};
use lambda_runtime::{service_fn, LambdaEvent};

use lambda_utils::aws_sdk::api_gateway::ApiGatewayProxyResponseWithoutHeaders;
use tracing::instrument;
use tracing::log::{error, info};

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        // disable printing the name of the module in every log line.
        .with_target(false)
        // disabling time is handy because CloudWatch will add the ingestion time.
        .without_time()
        .init();

    let environment_variables = EnvironmentVariables::build();
    let aws_clients = AwsClients::build().await;

    lambda_runtime::run(service_fn(
        |request: LambdaEvent<ApiGatewayProxyRequest>| {
            handler(&environment_variables, &aws_clients, request.payload)
        },
    ))
    .await?;

    Ok(())
}

const HARDCODED_PREFIX: &str = "discord";

#[derive(Serialize, Default)]
struct ResponseBody {
    url: String,
    days_until_get_recents: i64,
    weekly_recap: Option<Vec<String>>,
}

#[instrument(skip_all)]
async fn handler(
    environment_variables: &EnvironmentVariables,
    aws_clients: &AwsClients,
    req: ApiGatewayProxyRequest,
) -> Result<ApiGatewayProxyResponse, lambda_runtime::Error> {
    info!("handling a request: {:?}", req);

    let image_dao = ImageDynamoDao {
        table_name: &environment_variables.table_name,
        primary_key: &environment_variables.table_primary_key,
        sort_key: &environment_variables.table_sort_key,
        dynamodb_client: &aws_clients.dynamodb_client,
    };

    if req.http_method != Method::GET {
        panic!("Only handle GET requests should not receive any other request type");
    }

    let today = Local::now().date_naive();
    let today_as_string = today.format("%Y-%m-%d").to_string();

    info!("Today is {:?}", today);

    let set_image = match image_dao.get_image(HARDCODED_PREFIX, today).await {
        Ok(output) => Ok(output),
        Err(err) => {
            error!(
                "Object is not already set for today {} for reason {:?}",
                today_as_string, err
            );
            Err(ApiGatewayProxyResponseWithoutHeaders {
                status_code: 500,
                body: Body::Text(format!(
                    "Failed to get random object for the day: {:?}",
                    err
                )),
                is_base_64_encoded: false,
            }
            .build_full_response())
        }
    };

    match set_image {
        Ok(image) => {
            info!("The currently set image object is: {:?}", image);

            // Fetch weekly recap images if necessary
            let weekly_recap = if image.get_recents {
                image_dao
                    .get_recents(HARDCODED_PREFIX, today)
                    .await
                    .map_or(None, |recent_images| {
                        Some(
                            recent_images
                                .iter()
                                .map(|image| {
                                    format_image_url(
                                        &environment_variables.image_domain,
                                        &image.object_key,
                                    )
                                })
                                .collect::<Vec<String>>(),
                        )
                    })
            } else {
                None
            };

            let response_body = ResponseBody {
                url: format_image_url(&environment_variables.image_domain, &image.object_key),
                days_until_get_recents: image.days_until_get_recents,
                weekly_recap,
            };

            let response = serde_json::to_string(&response_body)?;

            Ok(ApiGatewayProxyResponseWithoutHeaders {
                status_code: 200,
                body: Body::Text(response),
                is_base_64_encoded: false,
            }
            .build_full_response())
        }
        Err(api_gateway_response) => Ok(api_gateway_response),
    }
}

fn format_image_url(domain: &str, object_key: &str) -> String {
    format!("https://{}/{}", domain, object_key)
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

struct EnvironmentVariables {
    image_domain: String,
    table_name: String,
    table_primary_key: String,
    table_sort_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let image_domain = std::env::var("IMAGE_DOMAIN")
            .expect("A IMAGE_DOMAIN must be set in this app's Lambda environment variables.");
        let table_name = std::env::var("TABLE_NAME")
            .expect("A TABLE_NAME must be set in this app's Lambda environment variables.");
        let table_primary_key = std::env::var("TABLE_PRIMARY_KEY")
            .expect("A TABLE_PRIMARY_KEY must be set in this app's Lambda environment varialbes.");
        let table_sort_key = std::env::var("TABLE_SORT_KEY")
            .expect("A TABLE_SORT_KEY must be set in this app's Lambda environment varialbes.");

        EnvironmentVariables {
            image_domain,
            table_name,
            table_primary_key,
            table_sort_key,
        }
    }
}
