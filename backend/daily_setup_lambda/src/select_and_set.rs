use std::collections::HashSet;

use chrono::NaiveDate;
use lambda_utils::persistence::{image_dynamo_dao::{ImageDynamoDao, ImageDynamoDaoError}, image_s3_dao::{ImageS3DaoError, ImageS3Dao}};

use rand::seq::SliceRandom;
use tracing::{log::{error, info}, instrument};

#[derive(Debug)]
pub enum SelectAndSetRandomObjectError {
    ImageDynamoDaoFailure(ImageDynamoDaoError),
    ImageS3DaoFailure(ImageS3DaoError),
    LocalError(String)
}

impl From<ImageDynamoDaoError> for SelectAndSetRandomObjectError {
    fn from(err: ImageDynamoDaoError) -> SelectAndSetRandomObjectError {
        SelectAndSetRandomObjectError::ImageDynamoDaoFailure(err)
    }
}

impl From<ImageS3DaoError> for SelectAndSetRandomObjectError {
    fn from(err: ImageS3DaoError) -> SelectAndSetRandomObjectError {
        SelectAndSetRandomObjectError::ImageS3DaoFailure(err)
    }
}


impl From<String> for SelectAndSetRandomObjectError {
    fn from(err: String) -> SelectAndSetRandomObjectError {
        SelectAndSetRandomObjectError::LocalError(err)
    }
}

const HARDCODED_PREFIX: &str = "discord";

#[instrument(skip_all)]
pub async fn select_and_set_random_s3_object(
    tomorrow: NaiveDate,
    image_dynamo_dao: &ImageDynamoDao<'_>,
    image_s3_dao: &ImageS3Dao<'_>,
) -> Result<String, SelectAndSetRandomObjectError> {

    // Get the images
    let list_of_images = match image_dynamo_dao.get_recents(HARDCODED_PREFIX, tomorrow).await {
        Ok(list_of_images) => list_of_images,
        Err(err) => {
            error!("Encountered the following error while trying to find the most recent images: {:?}. Using empty set", err);
            Vec::new()
        }
    };

    // Get set of all object_keys and if there has been a get_recents call
    let last_get_recent = list_of_images.iter().find(|image| image.get_recents);

    let days_since_get_recents = last_get_recent.map_or(
        0,
        |last_get_recent| tomorrow
            .signed_duration_since(last_get_recent.date)
            .num_days()
    );

    let set_of_recents = list_of_images.iter()
        .map(|image| image.object_key.to_owned())
        .collect::<HashSet<String>>();

    // List all objects in the bucket
    let objects_list = image_s3_dao.list_by_prefix(HARDCODED_PREFIX).await?;

    info!("The set of recent object_keys: {:?}", set_of_recents);

    // Chose a random object until it isn't one from the last five days (technically could loop forever? But shouldn't)
    let random_selected_object =    
    loop {
        let random_object = objects_list
            .choose(&mut rand::thread_rng())
            .ok_or_else(|| "Randomly selected object did not exist".to_owned())?;

        info!("Randomly selected object: {:?}", random_object);
        
        if random_object.key().is_some() && !set_of_recents.contains(random_object.key().unwrap()) {
            break random_object.to_owned()
        }
    };
    info!("Selected a random object: {:?}", random_selected_object);

    let object_key = image_dynamo_dao.set_image(
            HARDCODED_PREFIX,
            random_selected_object, 
            tomorrow, 
            days_since_get_recents
        )
        .await
        .map_err(|err| {
            error!("Failed to write the random object to dynamodb due to the following: {:?}", err);
            SelectAndSetRandomObjectError::LocalError("Failed to write the random object to dynamodb".to_owned())
        })?;

    info!("Successfully wrote random object to dynamodb");

    Ok(object_key)
}
