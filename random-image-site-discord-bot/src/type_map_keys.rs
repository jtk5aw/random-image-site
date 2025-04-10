use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use serenity::{
    async_trait,
    model::prelude::{ChannelId, GuildId, Message},
    prelude::{Context, TypeMapKey},
};
use tracing::{info, instrument};

/**
 * Shared map of GuildId to accepted channel.
 * Keeps track of channel ids for all #images channels
 */
pub struct AcceptedChannels;

impl TypeMapKey for AcceptedChannels {
    type Value = Arc<Mutex<HashMap<GuildId, Option<ChannelId>>>>;
}

#[async_trait]
pub trait AcceptedChannelsTrait {
    async fn accepted_channel(ctx: &Context, msg: &Message) -> bool;
}

#[async_trait]
impl AcceptedChannelsTrait for AcceptedChannels {
    #[instrument(skip_all)]
    async fn accepted_channel(ctx: &Context, msg: &Message) -> bool {
        // Only is None if not received over the Gateway. All messages should be
        let guild_id = msg.guild_id.unwrap();

        // Acquire a way to lock the currently accepted channels
        let current_accepted_channels_lock = {
            let data_read = ctx.data.read().await;
            data_read
                .get::<AcceptedChannels>()
                .expect("Expected Accepted Channels in TypeMap")
                .clone()
        };

        // Check if the messages guild_id already exists in the channel map
        let has_guild_id = {
            let current_accepted_channels = current_accepted_channels_lock.lock().unwrap();
            current_accepted_channels.contains_key(&guild_id)
        };

        // If it does not, try to find the #images channel and add it
        if !has_guild_id {
            info!(guild_id = %guild_id, "The current guild_id is not in the accepted_channels map. Adding it now.");

            // Fetch all channels for the current guild
            let channels = guild_id
                .channels(ctx)
                .await
                .map_or_else(|_err| HashMap::default(), |channels| channels);
            let channel_id = channels
                .iter()
                .find(|(_, channel)| channel.name == "images")
                .map_or_else(|| None, |(channel_id, _)| Some(channel_id.to_owned()));

            let mut current_accepted_channels = current_accepted_channels_lock.lock().unwrap();
            current_accepted_channels.insert(guild_id, channel_id);

            info!("A Optional channel_id was added to the accepted_channels map.");
        }

        // Finally compare the messages channel id with the #images channel id
        {
            let current_accepted_channels = current_accepted_channels_lock.lock().unwrap();
            let accepted_channel_id = current_accepted_channels
                .get(&guild_id)
                .unwrap_or(&None::<ChannelId>);

            // Use unwrap because it will short-circuit before reaching that
            accepted_channel_id.is_some() && accepted_channel_id.unwrap() == msg.channel_id
        }
    }
}

/**
 * Shared AWS clients and associated constants
 */
pub struct AwsClientsContainer {
    pub s3: aws_sdk_s3::Client,
    pub secrets_manager: aws_sdk_secretsmanager::Client,
}

pub struct AwsClients;

impl TypeMapKey for AwsClients {
    type Value = Arc<AwsClientsContainer>;
}

// TODO: Make this an env variable (maybe use SST link as well)
pub const IMAGE_BUCKET_NAME: &str = "get-image-lambda-bucket";

