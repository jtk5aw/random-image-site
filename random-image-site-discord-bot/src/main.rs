use std::collections::HashMap;
use std::io::Error as StdIoError;
use std::path::Path;
use std::sync::{Arc, Mutex};

use aws_config::BehaviorVersion;
use aws_sdk_s3::error::SdkError as S3SdkError;
use aws_sdk_s3::operation::put_object::PutObjectError;
use aws_sdk_s3::primitives::ByteStream;
use image::{DynamicImage, ImageError};
use random_image_site_discord_bot::type_map_keys::{
    AcceptedChannels, AcceptedChannelsTrait, AwsClients, AwsClientsContainer, IMAGE_BUCKET_NAME,
};
use reqwest::Error as ReqwestError;
use serenity::client::EventHandler;
use serenity::framework::standard::macros::{command, group, hook};
use serenity::framework::standard::{CommandResult, StandardFramework};
use serenity::model::channel::Message;
use serenity::prelude::{Context, GatewayIntents};
use serenity::{async_trait, Client};
use tracing::{error, info, info_span, instrument};
use uuid::Uuid;

#[group]
struct Images;

struct Handler;

#[async_trait]
impl EventHandler for Handler {}

// TODO: Move this to use SST linking
const DISCORD_SECRET_ID: &str = "discord_api_token";

#[tokio::main]
async fn main() {
    // Setup tracing
    let subscriber = tracing_subscriber::FmtSubscriber::new();
    // use that subscriber to process traces emitted after this point
    tracing::subscriber::set_global_default(subscriber).unwrap();

    info!("Initialized tracing");

    let config: aws_config::SdkConfig = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let secretsmanager_client = aws_sdk_secretsmanager::Client::new(&config);
    let token = secretsmanager_client
        .get_secret_value()
        .secret_id(DISCORD_SECRET_ID)
        .send()
        .await
        .map_or_else(
            |err| {
                error!(error = %err, "Failed to fetch the secret.");
                "bad_token".to_owned()
            },
            |token| token.secret_string().unwrap().to_owned(),
        );

    info!("Fetched discord bot token");

    let framework = StandardFramework::new()
        .normal_message(message)
        .group(&IMAGES_GROUP);
    let intents = GatewayIntents::non_privileged() | GatewayIntents::MESSAGE_CONTENT;
    let mut client = Client::builder(token, intents)
        .event_handler(Handler)
        .framework(framework)
        .await
        .expect("Error creating client");

    // Put in its own block to keep the write lock that data has open for as little time as possible
    // Idea is to minimize chance of deadlocks. Don't think its necessary here, think its just best practice
    {
        let mut data = client.data.write().await;

        data.insert::<AcceptedChannels>(Arc::new(Mutex::new(HashMap::default())));
    }

    let s3_client = aws_sdk_s3::Client::new(&config);

    {
        let mut data = client.data.write().await;
        data.insert::<AwsClients>(Arc::new(AwsClientsContainer {
            s3: s3_client,
            secrets_manager: secretsmanager_client,
        }));
    }

    info!("Initialized shared state");

    // start listening for events by starting a single shard
    if let Err(why) = client.start().await {
        println!("An error occurred while running the client: {:?}", why);
    }
}

#[command]
async fn ping(ctx: &Context, msg: &Message) -> CommandResult {
    msg.reply(ctx, "Pong!").await?;

    Ok(())
}

#[hook]
async fn message(ctx: &Context, msg: &Message) {
    let span = info_span!("message");
    let _guard = span.enter();

    info!(message_id = %msg.id);

    if !AcceptedChannels::accepted_channel(ctx, msg).await {
        info!(channel_id = %msg.channel_id, "Message not in the #images channel. Ignoring.");
        return;
    }

    info!(channel_id = %msg.channel_id, "Message is in the #images channel. Processing.");

    info!(message = ?msg);

    match get_attachment(ctx, msg).await {
        Ok(dynamic_image) => process_image(ctx, msg, dynamic_image).await,
        Err(GetAttachmentError::NoAttachmentError(_)) => {
            info!("No attachment. No processing necessary.")
        }
        Err(err) => {
            error!(error = ?err, "Failed to process the given attachment.");
        }
    };
}

#[derive(Debug)]
pub enum GetAttachmentError {
    LoadImageError(ImageError),
    GetImageError(ReqwestError),
    NoAttachmentError(String),
}

impl From<String> for GetAttachmentError {
    fn from(err: String) -> Self {
        Self::NoAttachmentError(err)
    }
}

impl From<ReqwestError> for GetAttachmentError {
    fn from(err: ReqwestError) -> Self {
        Self::GetImageError(err)
    }
}

impl From<ImageError> for GetAttachmentError {
    fn from(err: ImageError) -> Self {
        Self::LoadImageError(err)
    }
}

#[instrument(skip_all)]
async fn get_attachment(_ctx: &Context, msg: &Message) -> Result<DynamicImage, GetAttachmentError> {
    let attachment = msg
        .attachments
        .first()
        .ok_or_else(|| "No attachment found".to_owned())?;

    info!("Received an attachment from the provided message");

    let image_bytes = reqwest::get(&attachment.url).await?.bytes().await?;

    info!("Fetched the provided attachment from its url");

    Ok(image::load_from_memory(&image_bytes)?)
}

#[derive(Debug)]
pub enum ProcessingError {}

#[instrument(skip_all)]
async fn process_image(ctx: &Context, msg: &Message, image: DynamicImage) {
    match upload_image(ctx, image).await {
        Ok(()) => {
            info!("Processed the image successfully");
            if let Err(err) = msg
                .reply(ctx, "This iamge was successfuly processed!")
                .await
            {
                error!(error = %err, "Failed to reply to the message indicating it was processed successfully");
            };
        }
        Err(processing_error) => {
            error!("Failed to process the image");
            if let Err(reply_error) = msg
                .reply(
                    ctx,
                    format!(
                        "There was an error processing this attachemtn: {:?}",
                        processing_error
                    ),
                )
                .await
            {
                error!(error = %reply_error, "Failed to reply to the message indicating it was not processed");
            }
        }
    }
}

#[derive(Debug)]
pub enum UploadError {
    WriteError(ImageError),
    S3Error(S3SdkError<PutObjectError>),
    IoError(StdIoError),
}

impl From<ImageError> for UploadError {
    fn from(err: ImageError) -> Self {
        Self::WriteError(err)
    }
}

impl From<S3SdkError<PutObjectError>> for UploadError {
    fn from(err: S3SdkError<PutObjectError>) -> Self {
        Self::S3Error(err)
    }
}

impl From<StdIoError> for UploadError {
    fn from(err: StdIoError) -> Self {
        Self::IoError(err)
    }
}

async fn upload_image(ctx: &Context, dynamic_image: DynamicImage) -> Result<(), UploadError> {
    // Get the S3 Client to be used for writing
    let s3_client = {
        let data_read = ctx.data.read().await;
        let aws_clients_container = data_read
            .get::<AwsClients>()
            .expect("Expected AwsClientsContainer in TypeMap");
        aws_clients_container.s3.clone()
    };

    info!("Successfully grabbed the S3 Client");

    // Get the file in JPG format as bytes
    let uuid_str = Uuid::new_v4().to_string();

    let file_name = format!("discord_{}.jpg", uuid_str);
    dynamic_image.save(&file_name)?;
    // TODO: Remove this unwrap
    let body = ByteStream::from_path(Path::new(&file_name)).await.unwrap();

    info!(
        image_name = &file_name,
        "Sucessfully converted the image to JPG and got the image as bytes."
    );

    // Attempt to upload to S3
    let put_object_output = s3_client
        .put_object()
        .bucket(IMAGE_BUCKET_NAME)
        .key(&file_name)
        .content_type("image/jpeg")
        .body(body)
        .send()
        .await;

    // Attempt to delete the file before reporting the result of the S3 write
    tokio::fs::remove_file(&file_name).await?;

    info!("Successfully deleted the file from disk. Does NOT guarantee the file was written to S3");

    match put_object_output {
        Ok(_) => Ok(()),
        Err(error) => Err(UploadError::from(error)),
    }
}
