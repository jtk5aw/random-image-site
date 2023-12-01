use aws_config::BehaviorVersion;
use chrono::{Duration, NaiveDate};
use daily_setup_lambda::select_and_set::select_and_set_random_s3_object;
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use aws_sdk_dynamodb::Client as DynamoDbClient;
use aws_sdk_s3::Client as S3Client;
use lambda_utils::persistence::{user_reaction_dao::UserReactionDao, image_dynamo_dao::ImageDynamoDao, image_s3_dao::ImageS3Dao};
use serde::Deserialize;
use tracing::{info, error};

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

const HARDCODED_PREFIX: &str = "discord";

async fn function_handler(
    environment_variables: &EnvironmentVariables,
    aws_clients: &AwsClients,
    event: Request
) -> Result<(), Error> {
    // Extract some useful information from the request
    info!(event = ?event, "The event passed into the lambda is");

    let tomorrow_as_date= NaiveDate::parse_from_str(&event.time, "%Y-%m-%dT%H:%M:%SZ")? + Duration::days(1);
    let tomorrow_as_date_string = tomorrow_as_date.format("%Y-%m-%d").to_string();

    let user_reaction_dao = UserReactionDao {
        table_name: &environment_variables.table_name,
        primary_key: &environment_variables.table_primary_key,
        sort_key: &environment_variables.table_sort_key,
        dynamodb_client: &aws_clients.dynamodb_client
    };

    let image_dynamo_dao = ImageDynamoDao {
        table_name: &environment_variables.table_name,
        primary_key: &environment_variables.table_primary_key,
        sort_key: &environment_variables.table_sort_key,
        dynamodb_client: &aws_clients.dynamodb_client,
    };

    let image_s3_dao = ImageS3Dao {
        bucket_name: &environment_variables.bucket_name,
        s3_client: &aws_clients.s3_client
    };

    // Crashes the lambda and retries if this fails
    select_and_set_random_s3_object(tomorrow_as_date, &image_dynamo_dao, &image_s3_dao)
    .await
    .map_err(|err| {
        error!("Failed to get a random object from the bucket due to the following: {:?}", err);
    })
    .unwrap();

    // Make request to set up counts. Lambda should also crash if this fails too
    // (May lead to image for tomorrow getting set twice but thatn's not a big deal)
    user_reaction_dao.setup_counts(HARDCODED_PREFIX, &tomorrow_as_date_string)
    .await
    .unwrap();

    Ok(())
}

#[derive(Debug)]
struct EnvironmentVariables {
    bucket_name: String,
    table_name: String,
    table_primary_key: String,
    table_sort_key: String,
}

impl EnvironmentVariables {
    fn build() -> EnvironmentVariables {
        let bucket_name = std::env::var("BUCKET_NAME")
            .expect("A BUCKET_NAME must be set in this app's Lambda environment variables.");
        let table_name = std::env::var("TABLE_NAME")
            .expect("A TABLE_NAME must be set in this app's Lambda environment variables.");
        let table_primary_key = std::env::var("TABLE_PRIMARY_KEY")
            .expect("A TABLE_PRIMARY_KEY must be set in this app's Lambda environment varialbes.");
        let table_sort_key = std::env::var("TABLE_SORT_KEY")
            .expect("A TABLE_SORT_KEY must be provided");

        EnvironmentVariables { 
            bucket_name, 
            table_name, 
            table_primary_key,
            table_sort_key,
        }
    }
}

#[derive(Debug)]
struct AwsClients {
    s3_client: S3Client,
    dynamodb_client: DynamoDbClient
}

impl AwsClients {
    async fn build() -> AwsClients {
        // No extra configuration is needed as long as your Lambda has
        // the necessary permissions attached to its role.
        let config = aws_config::load_defaults(BehaviorVersion::latest()).await;

        let s3_client = aws_sdk_s3::Client::new(&config);
        let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);

        AwsClients {
            s3_client,
            dynamodb_client
        }
    }
}

