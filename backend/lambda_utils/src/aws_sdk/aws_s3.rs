use std::io::Read;

use async_trait::async_trait;
use aws_sdk_dynamodb::error::SdkError as S3SdkError;
use aws_sdk_s3::{operation::{list_objects::ListObjectsError, get_object::GetObjectError, write_get_object_response::WriteGetObjectResponseError}, Client as S3Client, types::Object, primitives::ByteStream};
use tracing::{info, instrument};

#[derive(Debug)]
pub enum S3UtilError {
    ListObjectsFailure(Box<S3SdkError<ListObjectsError>>),
    GetObjectFailure(Box<S3SdkError<GetObjectError>>),
    DownloadPresignedUrlFailure(ureq::Error),
    WriteGetObjectResponseFailure(Box<S3SdkError<WriteGetObjectResponseError>>),
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

impl From<ureq::Error> for S3UtilError {
    fn from(err: ureq::Error) -> S3UtilError {
        S3UtilError::DownloadPresignedUrlFailure(err)
    }
}

impl From<S3SdkError<WriteGetObjectResponseError>> for S3UtilError {
    fn from(err: S3SdkError<WriteGetObjectResponseError>) -> S3UtilError {
        S3UtilError::WriteGetObjectResponseFailure(Box::new(err))
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

    async fn get_file_from_s3_url(
        &self,
        url: &str
    ) -> Result<Vec<u8>, S3UtilError>;

    async fn send_to_get_object_response(
        &self, 
        route: String, 
        token: String, 
        bytes: Vec<u8>
    ) -> Result<(), S3UtilError>;
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

    ///
    /// Downloads the file using the provided presigned URL.
    /// 
    /// Taken from: https://github.com/awslabs/aws-lambda-rust-runtime/blob/d513b13b4c48122602c0690f55147607f3bcc0da/examples/basic-s3-object-lambda-thumbnail/src/s3.rs
    /// 
    /// # Arguments
    /// 
    /// * `url` - presigned url to be used to download the file
    /// 
    /// # Result
    /// * `Ok(Vec<u8>)` - Vector of bytes representing the S3 file that was downloaded
    /// * `Err(S3UtilError)` - Error in case an S3 call fails or some other issue occurs 
    /// 
    #[instrument(skip_all)]
    async fn get_file_from_s3_url(
        &self,
        url: &str
    ) -> Result<Vec<u8>, S3UtilError> {

        tracing::info!("File URL: {}", url);

        let resp = ureq::get(url).call()?;
        let len: usize = resp.header("Content-Length")
            .unwrap()
            .parse()
            .map_err(|err| format!("Failed to parse Content-Length as int: {}", err).to_owned())?;

        let mut bytes: Vec<u8> = Vec::with_capacity(len);

        std::io::Read::take(
            resp.into_reader(), 
            10_000_000
        ).read_to_end(&mut bytes).map_err(|err| format!("Failed to read all bytes: {}", err))?;

        tracing::info!("Received {} bytes", bytes.len());

        Ok(bytes)
    }
    
    ///
    /// Writes the provided bytes to a get object response location. 
    /// 
    /// Taken from: https://github.com/awslabs/aws-lambda-rust-runtime/blob/d513b13b4c48122602c0690f55147607f3bcc0da/examples/basic-s3-object-lambda-thumbnail/src/s3.rs
    /// 
    /// # Arguments
    /// 
    /// * `route` - Route from which bytes will be returned from
    /// * `token` - :shrug:
    /// * `bytes` - Bytes to be written 
    /// 
    /// # Result
    /// * `Ok()` - Data was successfully written to the output stream
    /// * `Err(S3UtilError)` - Error in case an S3 call fails or some other issue occurs 
    /// 
    #[instrument(skip_all)]
    async fn send_to_get_object_response(
        &self, 
        route: String, 
        token: String, 
        bytes: Vec<u8>
    ) -> Result<(), S3UtilError> {
        tracing::info!("send file route {}, token {}, length {}", route, token, bytes.len());

        let bytes = ByteStream::from(bytes);

        let write = self
            .write_get_object_response()
            .request_route(route)
            .request_token(token)
            .status_code(200)
            .body(bytes)
            .send()
            .await;

        match write {
            Ok(_) => Ok(()),
            Err(err) => {
                tracing::error!("Failed to write the bytestream to the object response: {}", err);
                
                Err(err.into())
            }
        }
    }
}