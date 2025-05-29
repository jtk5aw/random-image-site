use aws_sdk_s3::{types::Object, Client as S3Client};
use tracing::instrument;

use crate::aws_sdk::aws_s3::{S3Util, S3UtilError};

/*
 * TODO: This feels really stupid. I feel like both of the image DAOs should be able to be merged.
 * Especially since the DynamoDao has a reliance on Object right now.
 * The reason they aren't is cause in some cases the S3 fields aren't necesasry. I tried to make it so
 * that there was one big ImageDao that implemented .into() for both the "sub" daos that exist now.
 * I think I was fighting some fundamental aspect of the language so this works for now but it just feels ~wrong~
 */

#[derive(Debug)]
pub enum ImageS3DaoError {
    S3Error(S3UtilError),
    LocalError(String),
}

pub struct ImageS3Dao<'a> {
    pub bucket_name: &'a str,
    pub s3_client: &'a S3Client,
}

impl From<S3UtilError> for ImageS3DaoError {
    fn from(err: S3UtilError) -> ImageS3DaoError {
        ImageS3DaoError::S3Error(err)
    }
}

impl From<String> for ImageS3DaoError {
    fn from(err: String) -> ImageS3DaoError {
        ImageS3DaoError::LocalError(err)
    }
}

impl ImageS3Dao<'_> {
    ///
    /// List the objects in the associated bucket with the provided prefix.
    /// Return a list of Object's that contain metadata on the objects listed.
    ///
    /// # Result
    /// * `Ok(Vec<Object>)` - Array of Object's that contain the S3 objects metadata
    /// * `Err(ImageDaoError)` - Error in case of an S3 call failin or some other issue.
    ///
    #[instrument(skip_all)]
    pub async fn list_by_prefix(&self, prefix: &str) -> Result<Vec<Object>, ImageS3DaoError> {
        Ok(self
            .s3_client
            .list_items(self.bucket_name, Some(prefix))
            .await?)
    }
}
