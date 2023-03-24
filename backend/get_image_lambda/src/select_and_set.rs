use std::collections::{HashSet, HashMap};

use aws_sdk_s3::model::Object;
use chrono::{Local, DateTime, Days, Duration};
use log::{info, error};

use aws_sdk_s3::error::{GetObjectError, ListObjectsError};
use aws_sdk_s3::types::{SdkError as S3SdkError};
use aws_sdk_s3::output::GetObjectOutput;
use aws_sdk_dynamodb::model::{AttributeValue, KeysAndAttributes};
use aws_sdk_dynamodb::error::{BatchGetItemError, PutItemError};
use aws_sdk_dynamodb::types::SdkError as DynamoDbSdkError;
use rand::seq::SliceRandom;

#[derive(Debug)]
pub enum SelectAndSetRandomObjectError {
    SelectRandomObjectFailure(SelectRandomObjectError),
    SetRandomObjectFailure(SetRandomObjectError),
    GetObjectFailure(S3SdkError<GetObjectError>),
    LocalError(String)
}

impl From<SelectRandomObjectError> for SelectAndSetRandomObjectError {
    fn from(err: SelectRandomObjectError) -> SelectAndSetRandomObjectError {
        SelectAndSetRandomObjectError::SelectRandomObjectFailure(err)
    }
}

impl From<SetRandomObjectError> for SelectAndSetRandomObjectError {
    fn from(err: SetRandomObjectError) -> SelectAndSetRandomObjectError {
        SelectAndSetRandomObjectError::SetRandomObjectFailure(err)
    }
}

impl From<S3SdkError<GetObjectError>> for SelectAndSetRandomObjectError {
    fn from(err: S3SdkError<GetObjectError>) -> SelectAndSetRandomObjectError {
        SelectAndSetRandomObjectError::GetObjectFailure(err)
    }
}

impl From<String> for SelectAndSetRandomObjectError {
    fn from(err: String) -> SelectAndSetRandomObjectError {
        SelectAndSetRandomObjectError::LocalError(err)
    }
}

pub async fn select_and_set_random_s3_object(
    bucket_name: &str,
    table_name: &str,
    table_primary_key: &str,
    date_string: &str,
    dynamodb_client: &aws_sdk_dynamodb::Client,
    s3_client: &aws_sdk_s3::Client
) -> Result<GetObjectOutput, SelectAndSetRandomObjectError> {

    let set_of_recents = match get_recent_images(table_name, table_primary_key, dynamodb_client).await {
        Ok(set) => set,
        Err(err) => {
            error!("Encountered the following error while trying to find the most recent images: {:?}. Using empty set", err);
            HashSet::new()
        }
    };

    info!("The set of recent object_keys: {:?}", set_of_recents);

    let random_selected_object = select_random_s3_object(bucket_name, set_of_recents, s3_client)
        .await?;

    let random_selected_object_key = random_selected_object
        .key()
        .ok_or("Randomly selected objects key does not exist".to_owned())?;

    info!("Selected a random object with the following key: {:?}", random_selected_object_key);

    let _ = set_random_object_in_s3(table_name, table_primary_key, &random_selected_object, date_string, &dynamodb_client)
        .await
        .map_err(|err| {
            error!("Failed to write the random object to dynamodb due to the following: {:?}", err);
            SelectAndSetRandomObjectError::LocalError("Failed to write the random object to dynamodb".to_owned())
        })?;

    info!("Successfully wrote random object to dynamodb");

    s3_client
        .get_object()
        .bucket(bucket_name)
        .key(random_selected_object_key)
        .send()
        .await
        .map_err(|err| {
            SelectAndSetRandomObjectError::GetObjectFailure(err)
        })
}

#[derive(Debug)]
pub enum GetRecentImagesError {
    BatchGetFailure(DynamoDbSdkError<BatchGetItemError>),
    LocalError(String)
}

impl From<DynamoDbSdkError<BatchGetItemError>> for GetRecentImagesError {
    fn from(err: DynamoDbSdkError<BatchGetItemError>) -> GetRecentImagesError {
        GetRecentImagesError::BatchGetFailure(err)
    }
}

impl From<String> for GetRecentImagesError {
    fn from(err: String) -> GetRecentImagesError {
        GetRecentImagesError::LocalError(err)
    }
}

async fn get_recent_images(
    table_name: &str,
    table_primary_key: &str,
    dynamodb_client: &aws_sdk_dynamodb::Client
) -> Result<HashSet<String>, GetRecentImagesError> {

    // Get list of last five days
    let today = Local::now();
    let mut last_five_days = Vec::<DateTime<Local>>::new();
    for num in 1..=5 {
        last_five_days.push(today - Duration::days(num));
    };

    info!("List of last five days: {:?}", last_five_days);

    // Create BatchGetItem object that will be used in the request
    let mut batch_get_keys_and_attributes = KeysAndAttributes::builder();
    for day in last_five_days {
        batch_get_keys_and_attributes = batch_get_keys_and_attributes
        .keys(HashMap::from([(
            table_primary_key.to_string(),
            AttributeValue::S(day.format("%Y-%m-%d").to_string())
        )]));
    }
    let batch_get_keys_and_attributes = batch_get_keys_and_attributes.build();

    // Create set of items that get returned. Short circuit for any error thrown
    let generated_set = dynamodb_client
        .batch_get_item()
        .request_items(
            table_name,
            batch_get_keys_and_attributes)
        .send()
        .await?
        .responses()
        .ok_or("There were no available responses".to_owned())?
        .get(table_name)
        .ok_or("The desired table name returned not responses".to_owned())?
        .iter()
        .map(|key_and_vals| {
            match key_and_vals.get("object_key") {
                Some(value) => value.as_s().unwrap_or(&"".to_owned()).to_owned(),
                None => "".to_owned() // Including "" in the list is fine as there will be no actual object keys of ""
            }
        })
        .collect::<HashSet<String>>();

    info!("The set of generated keys to avoid: {:?}", generated_set);

    Ok(generated_set)
}

#[derive(Debug)]
pub enum SelectRandomObjectError {
    ListObjectsFailure(S3SdkError<ListObjectsError>),
    GetObjectFailure(S3SdkError<GetObjectError>),
    LocalError(String),
}

impl From<S3SdkError<ListObjectsError>> for SelectRandomObjectError {
    fn from(err: S3SdkError<ListObjectsError>) -> SelectRandomObjectError {
        SelectRandomObjectError::ListObjectsFailure(err)
    }
}

impl From<S3SdkError<GetObjectError>> for SelectRandomObjectError {
    fn from(err: S3SdkError<GetObjectError>) -> SelectRandomObjectError {
        SelectRandomObjectError::GetObjectFailure(err)
    }
}

impl From<String> for SelectRandomObjectError {
    fn from(err: String) -> SelectRandomObjectError {
        SelectRandomObjectError::LocalError(err)
    }
}

async fn select_random_s3_object(
    bucket_name: &str,
    set_of_recents: HashSet<String>,
    s3_client: &aws_sdk_s3::Client
) -> Result<Object, SelectRandomObjectError> {
    info!("Listing objects in the bucket");

    // Make request to list all objects in the bucket
    let list_objects_output = s3_client
        .list_objects()
        .bucket(bucket_name)
        .send()
        .await?;

    // Retrieve list of all objects in the bucket
    let objects_list = list_objects_output
        .contents()
        .ok_or("No List of returned values found".to_owned())?;

    info!("Found {} objects", objects_list.len());

    // Chose a random object until it isn't one from the last five days
    loop {
        let random_object = objects_list
            .choose(&mut rand::thread_rng())
            .ok_or("Randomly selected object did not exist".to_owned())?;

        info!("Randomly selected object: {:?}", random_object);
        
        if random_object.key().is_some() && !set_of_recents.contains(random_object.key().unwrap()) {
            return Ok(random_object.to_owned());
        }
    }

}

#[derive(Debug)]
pub enum SetRandomObjectError {
    PutItemFailure(DynamoDbSdkError<PutItemError>),
    LocalError(String),
}

impl From<DynamoDbSdkError<PutItemError>> for SetRandomObjectError {
    fn from(err: DynamoDbSdkError<PutItemError>) -> SetRandomObjectError {
        SetRandomObjectError::PutItemFailure(err)
    }
}

impl From<String> for SetRandomObjectError {
    fn from(err: String) -> SetRandomObjectError {
        SetRandomObjectError::LocalError(err)
    }
}

async fn set_random_object_in_s3(
    table_name: &str,
    table_primary_key: &str,
    object: &Object, 
    date_string: &str,
    dynamodb_client: &aws_sdk_dynamodb::Client
) -> Result<(), SetRandomObjectError> {

    info!("Writing object as the current day record");

    let object_key = object
        .key()
        .ok_or("Provided object's key does not exist".to_owned())?;

    let put_result = dynamodb_client
        .put_item()
        .table_name(table_name)
        .item(table_primary_key, AttributeValue::S(date_string.to_owned()))
        .item("object_key", AttributeValue::S(object_key.to_owned()))
        .send()
        .await?;

    info!("Put successful, consumed write units: {:?}", put_result.consumed_capacity());

    Ok(())
}
