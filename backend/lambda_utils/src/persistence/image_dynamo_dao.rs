use std::num::ParseIntError;

use aws_sdk_s3::types::Object;
use aws_sdk_dynamodb::{Client as DynamoDbClient, types::AttributeValue};
use chrono::{Duration, ParseError, NaiveDate};
use tracing::{instrument, info};

use crate::aws_sdk::aws_dynamodb::{DynamoDbUtilError, KeyAndAttribute, DynamoDbUtil, PK};

// Structs
pub struct ImageDynamoDao<'a> {
    pub table_name: &'a str,
    pub primary_key: &'a str,
    pub sort_key: &'a str,
    pub dynamodb_client: &'a DynamoDbClient,
}

#[derive(Debug, Eq, Hash, PartialEq)]
pub struct Image {
    pub object_key: String,
    pub get_recents: bool,
    pub days_until_get_recents: i64,
    pub date: NaiveDate,
}

// Error Enum
#[derive(Debug)]
pub enum ImageDynamoDaoError {
    DynamoDbError(DynamoDbUtilError),
    AttributeValueConversionError(AttributeValue),
    ChronoParseError(ParseError),
    ParseIntError(ParseIntError),
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

impl From<ParseError> for ImageDynamoDaoError {
    fn from(err: ParseError) -> ImageDynamoDaoError {
        ImageDynamoDaoError::ChronoParseError(err)
    }
}

impl From<ParseIntError> for ImageDynamoDaoError {
    fn from(err: ParseIntError) -> ImageDynamoDaoError {
        ImageDynamoDaoError::ParseIntError(err)
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
const DAYS_UNTIL_GET_RECENTS: &str = "days_until_get_recents";
const IMAGE: &str = "Image";

const DAYS_BETWEEN_GET_RECENTS: i64 = 5;

impl ImageDynamoDao<'_> {

    #[instrument(skip_all)]
    pub async fn get_image(
        &self,
        group: &str,
        date: NaiveDate,
    ) -> Result<Image, ImageDynamoDaoError> {
        let get_keys_and_attributes = self.build_get_image_key_and_attribute(group, date);

        let item = self.dynamodb_client.get_item_from_keys(
            self.table_name,
            get_keys_and_attributes,
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

        let days_until_get_recents = item
            .get(DAYS_UNTIL_GET_RECENTS)
            .map_or(5, |days_until_get_recents| {
                days_until_get_recents.as_n().map_or(5, |att_val| att_val.parse::<i64>().unwrap_or(5))
            });

        let date = item
            .get(PK)
            .map_or(
                NaiveDate::from_ymd_opt(2099, 12, 31).unwrap(),
                |pk| parse_date_from_primary_key(pk, NaiveDate::from_ymd_opt(2099, 12, 31).unwrap())
            );

        Ok(Image {
            object_key,
            get_recents,
            days_until_get_recents,
            date,
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
        group: &str,
        date: NaiveDate,
    ) -> Result<Vec<Image>, ImageDynamoDaoError> {

        let batch_get_keys_and_attributes = self.build_get_recents_key_and_attribute(group, date);

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
                    },
                    date: match key_and_vals.get(PK) {
                        Some(value) => parse_date_from_primary_key(
                            value,
                            NaiveDate::from_ymd_opt(2099, 12, 31).unwrap()
                        ),
                        None => NaiveDate::from_ymd_opt(2099, 12, 31).unwrap(),
                    },
                    days_until_get_recents: match key_and_vals.get(DAYS_UNTIL_GET_RECENTS) {
                        Some(value) => value.as_n().map_or(5, |att_val| att_val.parse::<i64>().unwrap_or(5)),
                        None => 5,
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
        group: &str,
        object: Object,
        date: NaiveDate,
        days_since_get_recents: i64,
    ) -> Result<String, ImageDynamoDaoError> {

        let object_key = object
            .key()
            .ok_or_else(|| "Provided object's key does not exist".to_owned())?;

        let get_recents = days_since_get_recents == 0;

        let days_until_get_recents = (DAYS_BETWEEN_GET_RECENTS + 1) - days_since_get_recents;
    
        info!(date = ?date, object_key = object_key, "Writing object as the record for date: ");
        info!(days_until_get_recents = days_until_get_recents, "Days until fetch recents: ");

        let keys_and_attributes = self.build_set_image_key_and_attribute(
            group, 
            date, 
            object_key, 
            get_recents,
            days_until_get_recents,
        );

        // TODO: Consider adding a conditional expressions for dates that haven't happened yet? 
        // I would say for any dates but its fine to overwrite a date for tomorrow so that's where
        // I'm coming from
        let _put_result = self.dynamodb_client.put_item_from_keys(
                self.table_name, 
                keys_and_attributes
            )
            .await?;

        Ok(object_key.to_owned())
    }

    /** Helper Functions that require state */
    #[instrument(skip_all)]
    fn build_get_image_key_and_attribute(
        &self,
        group: &str,
        date: NaiveDate, 
    ) -> Vec<KeyAndAttribute> {

        info!(date = ?date, group = group, "Date and group are");

        vec![
            KeyAndAttribute {
                key: self.primary_key,
                attribute: AttributeValue::S(format_primary_key(group, date)),
            },
            KeyAndAttribute {
                key: self.sort_key,
                attribute: AttributeValue::S(IMAGE.to_owned()),
            },
        ]
    }

    #[instrument(skip_all)]
    fn build_get_recents_key_and_attribute(
        &self,
        group: &str,
        date: NaiveDate 
    ) -> Vec<Vec<KeyAndAttribute>> {

        info!(date = ?date, group = group, "Date and group are: ");

        let mut key_and_attribute: Vec<Vec<KeyAndAttribute>> = Vec::<Vec<KeyAndAttribute>>::new();
        for num in 1..=DAYS_BETWEEN_GET_RECENTS {
            let date = date - Duration::days(num);

            info!(prev_date = ?date, "Next date is.");

            key_and_attribute.push(vec![
                KeyAndAttribute { 
                    key: self.primary_key, 
                    attribute: AttributeValue::S(format_primary_key(group, date))
                },
                KeyAndAttribute {
                    key: self.sort_key, 
                    attribute: AttributeValue::S(IMAGE.to_owned())
                },
            ])
        }
        key_and_attribute
    }

    #[instrument(skip_all)]
    fn build_set_image_key_and_attribute(
        &self,
        group: &str,
        date: NaiveDate,
        object_key: &str,
        get_recents: bool,
        days_until_get_recents: i64,
    ) -> Vec<KeyAndAttribute> {

        info!(date = ?date, group = group, object = object_key, "The day, group and object_key are: ");

        vec![
            KeyAndAttribute {
                key: self.primary_key,
                attribute: AttributeValue::S(format_primary_key(group, date)),
            },
            KeyAndAttribute {
                key: self.sort_key,
                attribute: AttributeValue::S(IMAGE.to_owned()),
            },
            KeyAndAttribute {
                key: OBJECT_KEY,
                attribute: AttributeValue::S(object_key.to_owned()),
            },
            KeyAndAttribute {
                key: GET_RECENTS,
                attribute: AttributeValue::Bool(get_recents),
            },
            KeyAndAttribute {
                key: DAYS_UNTIL_GET_RECENTS,
                attribute: AttributeValue::N(days_until_get_recents.to_string()),
            }
        ]
    }
}

// Helper functinos that don't require state
fn format_primary_key(
    group: &str, 
    date: NaiveDate
) -> String {
    format!(
        "{}_{}",
        group,
        date.format("%Y-%m-%d").to_string()
    )
}

fn parse_date_from_primary_key(
    value: &AttributeValue,
    default_date: NaiveDate
) -> NaiveDate {

    let string_value = value.as_s().unwrap_or(&"".to_owned()).to_owned();
    let date_str = string_value.split("_").last().unwrap();

    NaiveDate::parse_from_str(date_str, "%Y-%m-%d").unwrap_or(default_date)
}

