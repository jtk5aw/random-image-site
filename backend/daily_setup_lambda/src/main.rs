use aws_lambda_events::event::cloudwatch_events::CloudWatchEvent;
use chrono::{NaiveDate, Duration};
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use aws_sdk_dynamodb::{Client as DynamoDbClient};
use aws_sdk_s3::{Client as S3Client};
use serde::Deserialize;
use tracing::{info, instrument};

#[derive(Deserialize, Debug)]
struct Request {
    time: String,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        // disable printing the name of the module in every log line.
        .with_target(false)
        // disabling time is handy because CloudWatch will add the ingestion time.
        .without_time()
        .init();

    let environment_variables = EnvironmentVariables::build();
    let aws_clients = AwsClients::build().await;

    run(service_fn(|request: LambdaEvent<Request>| {
        function_handler(&environment_variables, &aws_clients, request.payload)
    })).await
}

async fn function_handler(
    environment_variables: &EnvironmentVariables,
    aws_clients: &AwsClients,
    event: Request
) -> Result<(), Error> {
    // Extract some useful information from the request
    info!(event = ?event, "The event passed into the lambda is");

    let tomorrow_as_date = NaiveDate::parse_from_str(&event.time, "%Y-%m-%d")? + Duration::days(1);
    let tomorrow_as_date_string = tomorrow_as_date.format("%Y-%m-%d").to_string();

    info!(tomorrow = tomorrow_as_date_string, "Tomorrow is: ");

    // select_and_set_random_s3_object(&environment_variables.bucket_name, &environment_variables.table_name, &environment_variables.table_primary_key, 
    //     &today_as_string, dynamodb_client, s3_client)
    // .await
    // .map_err(|err| {
    //     error!("Failed to get a random object from the bucket due to the following: {:?}", err);
    //     ApiGatewayProxyResponseWithoutHeaders {
    //         status_code: 500, 
    //         body: Body::Text(format!("Failed to get random object: {:?}", err)), 
    //         is_base_64_encoded: false
    //     }.build_full_response()
    // });

    Ok(())
}

struct EnvironmentVariables {
    bucket_name: String,
    table_name: String,
    table_primary_key: String,
    user_reaction_table_name: String,
    user_reaction_table_primary_key: String,
    user_reaction_table_sort_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let bucket_name = std::env::var("BUCKET_NAME")
            .expect("A BUCKET_NAME must be set in this app's Lambda environment variables.");
        let table_name = std::env::var("TABLE_NAME")
            .expect("A TABLE_NAME must be set in this app's Lambda environment variables.");
        let table_primary_key = std::env::var("TABLE_PRIMARY_KEY")
            .expect("A TABLE_PRIMARY_KEY must be set in this app's Lambda environment varialbes.");
        let user_reaction_table_name = std::env::var("USER_REACTION_TABLE_NAME")
            .expect("A USER_REACTION_TABLE_NAME must be provided");
        let user_reaction_table_primary_key = std::env::var("USER_REACTION_TABLE_PRIMARY_KEY")
            .expect("A USER_REACTION_TABLE_PRIMARY_KEY must be provided");
        let user_reaction_table_sort_key = std::env::var("USER_REACTION_TABLE_SORT_KEY")
            .expect("A USER_REACTION_TABLE_SORT_KEY must be provided");

        EnvironmentVariables { 
            bucket_name, 
            table_name, 
            table_primary_key,
            user_reaction_table_name,
            user_reaction_table_primary_key,
            user_reaction_table_sort_key
        }
    }
}

struct AwsClients {
    s3_client: S3Client,
    dynamodb_client: DynamoDbClient
}

impl AwsClients {
    async fn build() -> AwsClients {
        // No extra configuration is needed as long as your Lambda has
        // the necessary permissions attached to its role.
        let config = aws_config::load_from_env().await;

        let s3_client = aws_sdk_s3::Client::new(&config);
        let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);

        AwsClients {
            s3_client,
            dynamodb_client
        }
    }
}

