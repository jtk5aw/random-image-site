use async_trait::async_trait;
use aws_sdk_dynamodb::error::SdkError as S3SdkError;
use aws_sdk_s3::{operation::{list_objects::ListObjectsError, get_object::GetObjectError}, Client as S3Client, types::Object};
use tracing::{info, instrument};

#[derive(Debug)]
pub enum S3UtilError {
    ListObjectsFailure(Box<S3SdkError<ListObjectsError>>),
    GetObjectFailure(Box<S3SdkError<GetObjectError>>),
    LocalError(String),
}

impl From<S3SdkError<ListObjectsError>> for S3UtilError {
    fn from(err: S3SdkError<ListObjectsError>) -> S3UtilError {
        S3UtilError::ListObjectsFailure(Box::new(err))
    }
}

impl From<S3SdkError<GetObjectError>> for S3UtilError {
    fn from(err: S3SdkError<GetObjectError>) -> S3UtilError {
        S3UtilError::GetObjectFailure(Box::new(err))
    }
}

impl From<String> for S3UtilError {
    fn from(err: String) -> S3UtilError {
        S3UtilError::LocalError(err)
    }
}

#[async_trait]
pub trait S3Util {
    async fn list_items(
        &self,
        bucket_name: &str,
        prefix: Option<&str>
    ) -> Result<Vec<Object>, S3UtilError>;
}

#[async_trait]
impl S3Util for S3Client {

    ///
    /// Lists the objects in the provided bucket. Optionally filters based on the provided prefix. 
    /// Returns a vector of Object's containing metadata about the S3 objects listed.
    ///
    /// # Arguments
    /// 
    /// * `bucket_name` - The bucket whos contents are being listed
    /// * `prefix` - An optional string to filter the contents of the bucket on
    /// 
    /// # Result
    /// * `Ok(Vec<Object>)` - Array of Objects's that contain metadata about the S3 objects listed
    /// * `Err(S3UtilError)` - Error in case an S3 call fails or some other issue occurs 
    /// 
    #[instrument(skip_all)]
    async fn list_items(
        &self,
        bucket_name: &str,
        prefix: Option<&str>
    ) -> Result<Vec<Object>, S3UtilError> {
        // Build request to list all objects in the bucket adding the prefix if it exists
        let list_objects_request = self
            .list_objects()
            .bucket(bucket_name);

        let list_objects_request = match prefix {
            Some(prefix_str) => list_objects_request.prefix(prefix_str),
            None => list_objects_request
        };

        // Make the request to list objects and copy the metadata into a Vec
        let list_objects_output = list_objects_request
            .send()
            .await?;

        let objects_list = list_objects_output
            .contents();

        info!("Found {} objects", objects_list.len());

        Ok(objects_list.to_owned())
    }
}