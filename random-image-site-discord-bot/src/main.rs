use std::collections::{HashMap};
use std::sync::{Arc, Mutex};

use image::{DynamicImage, ImageError};
use random_image_site_discord_bot::type_map_keys::{AcceptedChannels, AcceptedChannelsTrait, AwsClients, AwsClientsContainer};
use reqwest::{Error as ReqwestError};
use serenity::{async_trait, Client};
use serenity::client::EventHandler;
use serenity::framework::standard::macros::{hook, group, command};
use serenity::model::channel::Message;
use serenity::framework::standard::{StandardFramework, CommandResult};
use serenity::prelude::{GatewayIntents, Context};
use tracing::{info_span, info, error, instrument};

#[group]
struct Images;

struct Handler;

#[async_trait]
impl EventHandler for Handler {}

const DISCORD_SECRET_ID: &str = "discord_api_token";

#[tokio::main]
async fn main() {
    // Setup tracing
    let subscriber = tracing_subscriber::FmtSubscriber::new();
    // use that subscriber to process traces emitted after this point
    tracing::subscriber::set_global_default(subscriber).unwrap();

    info!("Initialized tracing");

    let config: aws_config::SdkConfig = aws_config::load_from_env().await;
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
            |token| token.secret_string().unwrap().to_owned()
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

    let secretsmanager_client = aws_sdk_secretsmanager::Client::new(&config);


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
            secrets_manager: secretsmanager_client
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
        Err(GetAttachmentError::NoAttachmentError(_)) => info!("No attachment. No processing necessary."),
        Err(err) => {
            error!(error = ?err, "Failed to process the given attachment.");
        }
    };
}

#[derive(Debug)]
pub enum GetAttachmentError {
    LoadImageError(ImageError),
    GetImageError(ReqwestError),
    NoAttachmentError(String)
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
    let attachment = msg.attachments.first()
        .ok_or_else(|| "No attachment found".to_owned())?;

    info!("Received an attachment from the provided message");

    let image_bytes = reqwest::get(&attachment.url)
        .await?
        .bytes()
        .await?;

    info!("Fetched the provided attachment from its url");

    Ok(image::load_from_memory(&image_bytes)?)
}

#[derive(Debug)]
pub enum ProcessingError {}

#[instrument(skip_all)]
async fn process_image(ctx: &Context, msg: &Message, image: DynamicImage) {
    match upload_image(image).await {
        Ok(()) => {
            info!("Processed the image successfully");
            if let Err(err) = msg.reply(ctx, "This iamge was successfuly processed!").await {
                error!(error = %err, "Failed to reply to the message indicating it was processed successfully");
            };
        },
        Err(processing_error) => {
            error!("Failed to process the image");
            if let Err(reply_error) = msg.reply(ctx, format!("There was an error processing this attachemtn: {:?}", processing_error)).await {
                error!(error = %reply_error, "Failed to reply to the message indicating it was not processed");
            }
        }
    }
}

#[derive(Debug)]
pub enum UploadError {
    WriteError(ImageError)
}

impl From<ImageError> for UploadError {
    fn from(err: ImageError) -> Self {
        Self::WriteError(err)
    }
}

async fn upload_image(image: DynamicImage) -> Result<(), UploadError> {
    // Figure out how to pass in S3 Client
    // should be able to be used across threads so not sure how that will work with TypeValueKey
    // That might honestly be overkill, might be possible to share clients another way? 
    Ok(image.save("test_image.jpg")?)
}