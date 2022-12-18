use log::{info, error};
use rand::seq::SliceRandom;

use aws_sdk_s3::model::Object;
use aws_sdk_s3::error::{ListObjectsError, GetObjectError};
use aws_sdk_s3::types::{SdkError as S3SdkError};
use aws_sdk_s3::output::GetObjectOutput;
use aws_sdk_dynamodb::model::AttributeValue;
use aws_sdk_dynamodb::error::PutItemError;
use aws_sdk_dynamodb::types::SdkError as DynamoDbSdkError;

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

    let random_selected_object = select_random_s3_object(bucket_name, s3_client)
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
        .key(random_selected_object_key)
        .send()
        .await
        .map_err(|err| {
            SelectAndSetRandomObjectError::GetObjectFailure(err)
        })
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
    s3_client: &aws_sdk_s3::Client
) -> Result<Object, SelectRandomObjectError> {
    info!("Listing objects in the bucket");

    let list_objects_output = s3_client
        .list_objects()
        .bucket(bucket_name)
        .send()
        .await?;

    let objects_list = list_objects_output
        .contents()
        .ok_or("No List of returned values found".to_owned())?;

    info!("Found {} objects", objects_list.len());

    match objects_list
        .choose(&mut rand::thread_rng()) {
            Some(object) => Ok(object.to_owned()),
            None => Err(SelectRandomObjectError::LocalError("Randomly selected object did not exist".to_owned()))
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
