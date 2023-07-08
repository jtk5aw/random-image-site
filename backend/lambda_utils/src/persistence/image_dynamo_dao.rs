
use aws_sdk_s3::types::Object;
use aws_sdk_dynamodb::{Client as DynamoDbClient, types::{AttributeValue}};
use chrono::{DateTime, Duration, FixedOffset};
use tracing::{instrument, info};

use crate::aws_sdk::{aws_dynamodb::{DynamoDbUtilError, KeyAndAttribute, DynamoDbUtil}};

// Structs
pub struct ImageDynamoDao<'a> {
    pub table_name: &'a str,
    pub primary_key: &'a str,
    pub dynamodb_client: &'a DynamoDbClient,
}

#[derive(Debug, Eq, Hash, PartialEq)]
pub struct Image {
    pub object_key: String,
    pub get_recents: bool,
}

// Error Enum
#[derive(Debug)]
pub enum ImageDynamoDaoError {
    DynamoDbError(DynamoDbUtilError),
    AttributeValueConversionError(AttributeValue),
    LocalError(String)
}

impl From<DynamoDbUtilError> for ImageDynamoDaoError {
    fn from(err: DynamoDbUtilError) -> ImageDynamoDaoError {
        ImageDynamoDaoError::DynamoDbError(err)
    }
}

impl From<AttributeValue> for ImageDynamoDaoError {
    fn from(err: AttributeValue) -> ImageDynamoDaoError {
        ImageDynamoDaoError::AttributeValueConversionError(err)
    }
}

impl From<String> for ImageDynamoDaoError {
    fn from(err: String) -> ImageDynamoDaoError {
        ImageDynamoDaoError::LocalError(err)
    }
}

// Implementation
const OBJECT_KEY: &str = "object_key";
const GET_RECENTS: &str = "get_recents";

impl ImageDynamoDao<'_> {

    #[instrument(skip_all)]
    pub async fn get_image(
        &self,
        date: DateTime<FixedOffset>,
    ) -> Result<Image, ImageDynamoDaoError> {
        let item = self.dynamodb_client.get_item_from_key(
            self.table_name,
            self.primary_key,
            date.format("%Y-%m-%d").to_string()
        )
        .await?;

        let object_key = item
            .get(OBJECT_KEY)
            .ok_or_else(|| "Set object object_key does not exist".to_owned())?
            .as_s()
            .map_err(|att_val| {
                att_val.to_owned()
            })?
            .to_owned();

        let get_recents = item
            .get(GET_RECENTS)
            .map_or(false, |get_recents| {
                get_recents.as_bool().map_or(false, |att_val| att_val.to_owned())
            });

        Ok(Image {
            object_key,
            get_recents
        })
    }

    ///
    /// Given a date get the last five images from previous days not including the provided date. 
    /// Returns a set of S3 keys represented as strings
    /// 
    /// # Arguments
    /// * `date` - Date represing the date to count backwards from
    /// 
    /// # Returns 
    /// * `Ok(HashSet<Image>)` - Returns a HashSet of Image structs
    /// * `Error(ImageDaoError)` - Any failure that occurs when calling DynamoDb or parsing the output
    /// 
    #[instrument(skip_all)]
    pub async fn get_recents(
        &self,
        date: DateTime<FixedOffset>,
    ) -> Result<Vec<Image>, ImageDynamoDaoError> {

        let batch_get_keys_and_attributes = self.build_get_recents_key_and_attribute(date);

        // Create set of items that get returned. Short circuit for any error thrown
        let generated_set = self.dynamodb_client
            .batch_get_item_from_keys(
                self.table_name,
                batch_get_keys_and_attributes
            )
            .await?
            .iter()
            .map(|key_and_vals| {
                Image {
                    object_key: match key_and_vals.get(OBJECT_KEY) {
                        Some(value) => value.as_s().unwrap_or(&"".to_owned()).to_owned(),
                        None => "".to_owned() // Including "" in the list is fine as there will be no actual object keys of ""
                    },
                    get_recents: match key_and_vals.get(GET_RECENTS) {
                        Some(value) => value.as_bool().unwrap_or(&false).to_owned(),
                        None => false,
                    }
                }
            })
            .collect::<Vec<Image>>();

        info!(set = ?generated_set, "The set of recent keys: ");

        Ok(generated_set)

    }

    #[instrument(skip_all)]
    pub async fn set_image(
        &self,
        object: Object,
        date: DateTime<FixedOffset>,
        get_recents: bool
    ) -> Result<String, ImageDynamoDaoError> {

        let object_key = object
            .key()
            .ok_or_else(|| "Provided object's key does not exist".to_owned())?;
    
        info!(date = ?date, object_key = object_key, "Writing object as the record for date: ");

        let keys_and_attributes = self.build_set_image_key_and_attribute(date, object_key, get_recents);

        let _put_result = self.dynamodb_client.put_item_from_keys(
                self.table_name, 
                keys_and_attributes
            )
            .await?;

        Ok(object_key.to_owned())
    }

    /** Helper Functions that require state */
    #[instrument(skip_all)]
    fn build_get_recents_key_and_attribute(
        &self,
        date: DateTime<FixedOffset>
    ) -> Vec<KeyAndAttribute> {

        info!(date = ?date, "Date is.");

        let mut key_and_attribute: Vec<KeyAndAttribute> = Vec::<KeyAndAttribute>::new();
        for num in 1..=5 {
            let date = date - Duration::days(num);

            info!(prev_date = ?date, "Next date is.");

            key_and_attribute.push(KeyAndAttribute { 
                key: self.primary_key, 
                attribute: AttributeValue::S(date.format("%Y-%m-%d").to_string())
            })
        }
        key_and_attribute
    }

    #[instrument(skip_all)]
    fn build_set_image_key_and_attribute(
        &self,
        date: DateTime<FixedOffset>,
        object_key: &str,
        get_recents: bool,
    ) -> Vec<KeyAndAttribute> {

        info!(date = ?date, object = object_key, "The day being written and the object being written are: ");

        vec![
            KeyAndAttribute {
                key: self.primary_key,
                attribute: AttributeValue::S(date.format("%Y-%m-%d").to_string()),
            },
            KeyAndAttribute {
                key: OBJECT_KEY,
                attribute: AttributeValue::S(object_key.to_owned()),
            },
            KeyAndAttribute {
                key: GET_RECENTS,
                attribute: AttributeValue::Bool(get_recents),
            }
        ]
    }
}