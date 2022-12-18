use serde::{Serialize, Deserialize};
use log::{LevelFilter, info, error};
use chrono::Local;
use simple_logger::SimpleLogger;

use lambda_runtime::handler_fn;

use get_image_lambda::get_already_set::get_already_set_object;
use get_image_lambda::select_and_set::select_and_set_random_s3_object;

#[derive(Deserialize)]
struct Request {
    pub body: String,
}

#[derive(Debug, Serialize)]
struct SuccessResponse {
    pub body: String,
}

#[derive(Debug, Serialize)]
struct FailureResponse {
    pub body: String,
}

// Implement Display for the Failure response so that we can then implement Error.
impl std::fmt::Display for FailureResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.body)
    }
}

// Implement Error for the FailureResponse so that we can `?` (try) the Response
// returned by `lambda_runtime::run(func).await` in `fn main`.
impl std::error::Error for FailureResponse {}

type Response = Result<SuccessResponse, FailureResponse>;

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

async fn handler(req: Request, _ctx: lambda_runtime::Context) -> Response {
    // TODO: Change this to take all the pictures in the provided s3 bucket and pick a 
    // randome one. Write to DynamoDB with some key (CURRENT_DAY) and then link the s3 key

    info!("handling a request...");
    let bucket_name = std::env::var("BUCKET_NAME")
        .expect("A BUCKET_NAME must be set in this app's Lambda environment variables.");
    let table_name = std::env::var("TABLE_NAME")
        .expect("A TABLE_NAME must be set in this app's Lambda environment variables.");
    let table_primary_key = std::env::var("TABLE_PRIMARY_KEY")
        .expect("A TABLE_PRIMARY_KEY must be set in this app's Lambda environment varialbes.");

    // No extra configuration is needed as long as your Lambda has
    // the necessary permissions attached to its role.
    let config = aws_config::load_from_env().await;

    let s3_client = aws_sdk_s3::Client::new(&config);
    let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);

    let today_as_string = Local::now()
        .format("%Y-%m-%d")
        .to_string();

    info!("Today is {}", today_as_string);

    let set_object = match get_already_set_object(&table_name, &table_primary_key, &today_as_string, &dynamodb_client, &s3_client)
        .await {
            Ok(output) => output,
            Err(err) => {
                info!("Object is not already set for today {} for reason {:?}", today_as_string, err);
                let random_object_output = select_and_set_random_s3_object(&bucket_name, &table_name, &table_primary_key, 
                        &today_as_string, &dynamodb_client, &s3_client)
                    .await
                    .map_err(|err| {
                        error!("Failed to get a random object from the bucket due to the following: {:?}", err);
                        FailureResponse {
                            body: "Failed when trying to select a random object".to_owned()
                        }
                    })?;
                
                random_object_output
            }
        };

    let bytes = set_object
        .body
        .collect()
        .await
        .map_err(|err| {
            error!("Failed to read the entire s3 objects body due to {}", err);
            FailureResponse {
                body: "Failed to read the selected s3 objects body".to_owned()
            }
        })?
        .into_bytes();

    Ok(SuccessResponse {
        body: base64::encode(bytes)
    })
}
