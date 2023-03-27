use aws_sdk_dynamodb::model::AttributeValue;
use lambda_utils::aws_sdk::{DynamoDbUtilError, DynamoDbUtil};
use log::info;

use aws_sdk_s3::error::GetObjectError;
use aws_sdk_s3::types::{SdkError as S3SdkError};
use aws_sdk_s3::output::GetObjectOutput;

#[derive(Debug)]
pub enum GetAlreadySetObjectError {
    GetItemFromKeyError(DynamoDbUtilError),
    GetObjectFalure(Box<S3SdkError<GetObjectError>>),
    AttributeValueConversionFailure(AttributeValue),
    LocalError(String),
}

impl From<DynamoDbUtilError> for GetAlreadySetObjectError {
    fn from(err: DynamoDbUtilError) -> GetAlreadySetObjectError {
        GetAlreadySetObjectError::GetItemFromKeyError(err)
    }
}

impl From<AttributeValue> for GetAlreadySetObjectError {
    fn from(err: AttributeValue) -> GetAlreadySetObjectError {
        GetAlreadySetObjectError::AttributeValueConversionFailure(err)
    }
}

impl From<S3SdkError<GetObjectError>> for GetAlreadySetObjectError {
    fn from(err: S3SdkError<GetObjectError>) -> GetAlreadySetObjectError {
        GetAlreadySetObjectError::GetObjectFalure(Box::new(err))
    }
}


impl From<String> for GetAlreadySetObjectError {
    fn from(err: String) -> GetAlreadySetObjectError {
        GetAlreadySetObjectError::LocalError(err)
    }
}

pub async fn get_already_set_object(
    bucket_name: &str,
    table_name: &str,
    table_primary_key: &str,
    date_string: &str,
    dynamodb_client: &aws_sdk_dynamodb::Client,
    s3_client: &aws_sdk_s3::Client
) -> Result<GetObjectOutput, GetAlreadySetObjectError> {

    info!("Check for already set object for {}", date_string);

    let item = dynamodb_client.get_item_from_key(
        table_name,
        table_primary_key,
        date_string.to_owned()
    ).await?;

    let object_key = item
        .get("object_key")
        .ok_or_else(|| "Set object object_key does not exist".to_owned())?
        .as_s()
        .map_err(|att_val| {
            att_val.to_owned()
        })?;

    s3_client
        .get_object()
        .bucket(bucket_name)
        .key(object_key.to_owned())
        .send()
        .await
        .map_err(|err| {
            GetAlreadySetObjectError::GetObjectFalure(Box::new(err))
        })
}

