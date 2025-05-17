use aws_config::BehaviorVersion;
use aws_lambda_events::encodings::Body;
use aws_lambda_events::event::apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse};
use aws_lambda_events::http::Method;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use chrono::{FixedOffset, Local};
use lambda_runtime::{service_fn, LambdaEvent};

use lambda_utils::aws_sdk::api_gateway::ApiGatewayProxyResponseWithoutHeaders;
use lambda_utils::persistence::user_reaction_dao::{UserReactionDao, UserReactionDaoError};
use serde::{Deserialize, Serialize};
use serde_json::Error as SerdeJsonError;
use tracing::{error, info, instrument};

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

#[instrument(skip_all)]
async fn handler(
    environment_variables: &EnvironmentVariables,
    aws_clients: &AwsClients,
    req: ApiGatewayProxyRequest,
) -> Result<ApiGatewayProxyResponse, lambda_runtime::Error> {
    info!(event = ?req, "The req passed into the lambda is");

    let user_reaction_dao = UserReactionDao {
        table_name: &environment_variables.table_name,
        primary_key: &environment_variables.table_primary_key,
        sort_key: &environment_variables.table_sort_key,
        dynamodb_client: &aws_clients.dynamodb_client,
    };

    if req.http_method != Method::PUT {
        panic!("Only handle PUT requests should not receive any other request type");
    }

    let today = Local::now().with_timezone(&FixedOffset::east_opt(0).unwrap());
    let today_as_string = today.format("%Y-%m-%d").to_string();

    info!(today = today_as_string, "Today is");

    let put_result = handle_put(req, &today_as_string, user_reaction_dao).await;

    Ok(put_result.unwrap_or_else(|err| {
            error!(error = ?err, "Failed to properly handle the incoming request due to");

            ApiGatewayProxyResponseWithoutHeaders {
                status_code: 500,
                body: Body::Text(format!("Failed to process the request: {:?}", err)),
                is_base_64_encoded: false,
            }
            .build_full_response()
        }))
}

// Body of the request to be recevied
#[derive(Serialize, Deserialize, Debug)]
struct RequestBody {
    uuid: String,
    favorite_image: String,
}

// Body of the response for PUT
#[derive(Serialize, Deserialize, Debug)]
struct ResponseBody {
    uuid: String,
    favorite_image: String,
}

// Error enum for PUT
#[derive(Debug)]
pub enum PutHandlerError {
    SerdeParseError(SerdeJsonError),
    UserReactionDaoError(UserReactionDaoError),
    LocalError(String),
}

impl From<SerdeJsonError> for PutHandlerError {
    fn from(err: SerdeJsonError) -> Self {
        Self::SerdeParseError(err)
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

async fn handle_put(
    req: ApiGatewayProxyRequest,
    today_as_string: &str,
    user_reaction_dao: UserReactionDao<'_>,
) -> Result<ApiGatewayProxyResponse, PutHandlerError> {
    let body_as_str = req.body.ok_or_else(|| "Body does not exist".to_owned())?;

    let body: RequestBody = serde_json::from_str(&body_as_str)?;

    info!(body_as_str = body_as_str, body = ?body, "The received body as a str and the parsed body value");

    let uuid = &body.uuid;
    let favorite_image = &body.favorite_image;

    // Set the favorite image
    let old_favorite_image = user_reaction_dao
        .set_favorite(HARDCODED_PREFIX, today_as_string, uuid, favorite_image)
        .await?;

    info!(
        old_favorite = old_favorite_image,
        "Request to update favorite image complete. The old favorite was"
    );

    let response_body = ResponseBody {
        favorite_image: favorite_image.to_owned(),
        uuid: uuid.to_owned(),
    };

    let response = serde_json::to_string(&response_body)?;

    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200,
        body: Body::Text(response),
        is_base_64_encoded: false,
    }
    .build_full_response())
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
    table_name: String,
    table_primary_key: String,
    table_sort_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let table_name = std::env::var("TABLE_NAME").expect("A TABLE_NAME must be provided");
        let table_primary_key =
            std::env::var("TABLE_PRIMARY_KEY").expect("A TABLE_PRIMARY_KEY must be provided");
        let table_sort_key =
            std::env::var("TABLE_SORT_KEY").expect("A TABLE_SORT_KEY must be provided");

        EnvironmentVariables {
            table_name,
            table_primary_key,
            table_sort_key,
        }
    }
}
