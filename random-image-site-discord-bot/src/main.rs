use std::collections::{HashMap};
use std::sync::Arc;

use serenity::async_trait;
use serenity::framework::standard::macros::{hook, group, command};
use serenity::model::prelude::{ChannelId, GuildId, Attachment};
use serenity::prelude::*;
use serenity::model::channel::Message;
use serenity::framework::standard::{StandardFramework, CommandResult};
use tracing::{info_span, info, event, error};

#[group]
struct Images;

struct Handler;

#[async_trait]
impl EventHandler for Handler {}

struct AcceptedChannels;

impl TypeMapKey for AcceptedChannels {
    type Value = Arc<Mutex<HashMap<GuildId, Option<ChannelId>>>>;
}

#[tokio::main]
async fn main() {
    // Setup tracing
    let subscriber = tracing_subscriber::FmtSubscriber::new();
    // use that subscriber to process traces emitted after this point
    tracing::subscriber::set_global_default(subscriber).unwrap();

    info!("Initialized tracing");

    // Login with a bot token from the environment
    let token = "";

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

    if !accepted_channel(ctx, msg).await {
        info!(channel_id = %msg.channel_id, "Message not in the #images channel. Ignoring.");
        return;
    }
    
    info!(channel_id = %msg.channel_id, "Message is in the #images channel. Processing.");

    match get_attachment(ctx, msg).await {
        Some(attachment) => process_attachment(ctx, msg, attachment).await,
        None => {
            info!("The message has no attachment.");
        }
    };
}

async fn accepted_channel(ctx: &Context, msg: &Message) -> bool {
    // Only is None if not received over the Gateway. All messages should be
    let guild_id = msg.guild_id.unwrap();

    // Acquire a way to lock the currently accepted channels
    let current_accepted_channels_lock = {
        let data_read = ctx.data.read().await;
        data_read.get::<AcceptedChannels>().expect("Expected Accepted Channels in TypeMap").clone()
    };

    // Check if the messages guild_id already exists in the channel map
    let has_guild_id = {
        let current_accepted_channels = current_accepted_channels_lock.lock().await;
        current_accepted_channels.contains_key(&guild_id)
    };

    // If it does not, try to find the #images channel and add it
    if !has_guild_id {
        info!(guild_id = %guild_id, "The current guild_id is not in the accepted_channels map. Adding it now.");

        // Fetch all channels for the current guild
        let channels = guild_id
            .channels(ctx)
            .await
            .map_or_else(
                |err| HashMap::default(), 
                |channels| channels
            );
        let channel_id = channels
            .iter()
            .find(|(_, channel)| channel.name == "images")
            .map_or_else(
                || None, 
                |(channel_id, _)| Some(channel_id.to_owned()));

        let mut current_accepted_channels = current_accepted_channels_lock.lock().await;
        current_accepted_channels.insert(guild_id, channel_id);

        info!("A Optional channel_id was added to the accepted_channels map.");
    }

    // Finally compare the messages channel id with the #images channel id
    { 
        let current_accepted_channels = current_accepted_channels_lock.lock().await;
        let accepted_channel_id = current_accepted_channels.get(&guild_id).unwrap_or(&None::<ChannelId>);

        // Use unwrap because it will short-circuit before reaching that
        accepted_channel_id.is_some() && accepted_channel_id.unwrap() == msg.channel_id
    }
}

async fn get_attachment(_ctx: &Context, _msg: &Message) -> Option<Attachment> {
    todo!("Get the attachement from the message");
}

#[derive(Debug)]
pub enum ProcessingError {}

async fn process_attachment(ctx: &Context, msg: &Message, attachment: Attachment) {
    match upload_attachment(attachment).await {
        Ok(()) => {
            info!("Processed the attachment successfully");
            if let Err(err) = msg.reply(ctx, "This attachement was successfuly processed!").await {
                error!(error = %err, "Failed to reply to the message indicating it was processed successfully");
            };
        },
        Err(processing_error) => {
            error!("Failed to process the attachment");
            if let Err(reply_error) = msg.reply(ctx, format!("There was an error processing this attachemtn: {:?}", processing_error)).await {
                error!(error = %reply_error, "Failed to reply to the message indicating it was not processed");
            }
        }
    }
}

#[derive(Debug)]
pub enum UploadError {}

async fn upload_attachment(attachment: Attachment) -> Result<(), UploadError> {
    todo!("Implement converstion to JPG from PNG and also the upload functionality. Probably need to pass in an S3 client somehow");
}