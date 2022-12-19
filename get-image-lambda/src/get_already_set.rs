use log::info;

use aws_sdk_s3::error::GetObjectError;
use aws_sdk_s3::types::{SdkError as S3SdkError};
use aws_sdk_s3::output::GetObjectOutput;
use aws_sdk_dynamodb::model::AttributeValue;
use aws_sdk_dynamodb::error::GetItemError;
use aws_sdk_dynamodb::types::SdkError as DynamoDbSdkError;

#[derive(Debug)]
pub enum GetAlreadySetObjectError {
    GetItemFailure(DynamoDbSdkError<GetItemError>),
    AttributeValueConversionFailure(AttributeValue),
    GetObjectFalure(S3SdkError<GetObjectError>),
    LocalError(String),
}

impl From<DynamoDbSdkError<GetItemError>> for GetAlreadySetObjectError {
    fn from(err: DynamoDbSdkError<GetItemError>) -> GetAlreadySetObjectError {
        GetAlreadySetObjectError::GetItemFailure(err)
    }
}

impl From<AttributeValue> for GetAlreadySetObjectError {
    fn from(err: AttributeValue) -> GetAlreadySetObjectError {
        GetAlreadySetObjectError::AttributeValueConversionFailure(err)
    }
}

impl From<S3SdkError<GetObjectError>> for GetAlreadySetObjectError {
    fn from(err: S3SdkError<GetObjectError>) -> GetAlreadySetObjectError {
        GetAlreadySetObjectError::GetObjectFalure(err)
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

    let get_item_result = dynamodb_client
        .get_item()
        .table_name(table_name)
        .key(table_primary_key, AttributeValue::S(date_string.to_owned()))
        .send()
        .await?;
    
    let item = get_item_result
        .item()
        .ok_or("Getting set object failed".to_owned())?;

    let object_key = item
        .get("object_key")
        .ok_or("Set object object_key does not exist".to_owned())?
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
            GetAlreadySetObjectError::GetObjectFalure(err)
        })
}

