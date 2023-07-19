use aws_sdk_dynamodb::Client as DynamoDbClient;
use lambda_runtime::{service_fn, LambdaEvent};
use aws_lambda_events::event::apigw::{ApiGatewayProxyRequest, ApiGatewayProxyResponse};
use aws_lambda_events::encodings::Body;

use lambda_utils::aws_sdk::api_gateway::ApiGatewayProxyResponseWithoutHeaders;
use tracing::{instrument, info};


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

    lambda_runtime::run(service_fn(|request: LambdaEvent<ApiGatewayProxyRequest>| {
        handler(&environment_variables, &aws_clients, request.payload)
    })).await?;

    Ok(())
}

#[instrument(skip_all)]
async fn handler(
    environment_variables: &EnvironmentVariables, 
    aws_clients: &AwsClients, 
    req: ApiGatewayProxyRequest
) -> Result<ApiGatewayProxyResponse, lambda_runtime::Error> {
    info!(event = ?req, "The req passed into the lambda is");

    Ok(ApiGatewayProxyResponseWithoutHeaders {
        status_code: 200,
        body: Body::Text("testing testing".to_owned()),
        is_base_64_encoded: false
    }.build_full_response())
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