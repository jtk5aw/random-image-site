use aws_config::BehaviorVersion;
use aws_lambda_events::s3::object_lambda::S3ObjectLambdaEvent;
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use lambda_utils::aws_sdk::aws_s3::S3Util;

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        // disable printing the name of the module in every log line.
        .with_target(false)
        // disabling time is handy because CloudWatch will add the ingestion time.
        .without_time()
        .init();

    let aws_clients = AwsClients::build().await;

    run(service_fn(|request: LambdaEvent<S3ObjectLambdaEvent>| {
        function_handler(&aws_clients, request)
    })).await
}

// Heavily borrows from: https://github.com/awslabs/aws-lambda-rust-runtime/blob/d513b13b4c48122602c0690f55147607f3bcc0da/examples/basic-s3-object-lambda-thumbnail/src/main.rs#L3

async fn function_handler(
    aws_clients: &AwsClients,
    event: LambdaEvent<S3ObjectLambdaEvent>
) -> Result<(), Error> {
    // Get S3 Client
    let s3_client = &aws_clients.s3_client;

    // Extract some useful information from the request
    let get_object_context = event.payload.get_object_context.expect("Did not provide a get_object_context");

    let route = get_object_context.output_route;
    let token = get_object_context.output_token;
    let s3_url = get_object_context.input_s3_url;

    tracing::info!("Request info, Route: {}, Token: {}, s3_url: {}", route, token, s3_url);

    let image = s3_client.get_file_from_s3_url(&s3_url).await.map_err(|err| {
        tracing::error!("Failed to load image: {:?}", err);
        "Failed to load image".to_string()
    })?;
    tracing::info!("Image loaded. Length: {}", image.len());

    s3_client.send_to_get_object_response(route, token, image).await.map_err(|err| {
        tracing::error!("Failed to send object response: {:?}", err);
        "Failed to send object response".to_string().into()
    })
}

struct AwsClients {
    s3_client: aws_sdk_s3::Client
}

impl AwsClients {
    async fn build() -> AwsClients {
        // No extra configuration is needed as long as your Lambda has
        // the necessary permissions attached to its role.
        let config = aws_config::load_defaults(BehaviorVersion::latest()).await;

        let s3_client = aws_sdk_s3::Client::new(&config);

        AwsClients {
            s3_client
        }
    }
}
