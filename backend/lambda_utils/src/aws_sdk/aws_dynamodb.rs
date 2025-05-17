use std::collections::HashMap;

use async_trait::async_trait;
use aws_sdk_dynamodb::error::BuildError;
use aws_sdk_dynamodb::{
    error::SdkError as DynamoDbSdkError,
    operation::{
        batch_get_item::{builders::BatchGetItemFluentBuilder, BatchGetItemError},
        get_item::{builders::GetItemFluentBuilder, GetItemError},
        put_item::{builders::PutItemFluentBuilder, PutItemError},
        update_item::{builders::UpdateItemFluentBuilder, UpdateItemError},
    },
    types::{AttributeValue, KeysAndAttributes, ReturnValue},
    Client as DynamoDbClient,
};

/**
 * Shared constants
 */
pub const PK: &str = "pk";

/**
 * Util Functions for making calls to DynamoDB
 */
#[derive(Debug)]
pub struct KeyAndAttribute<'a> {
    pub key: &'a str,
    pub attribute: AttributeValue,
}

#[derive(Debug)]
pub struct KeyAndAttributeName<'a> {
    pub key: &'a str,
    pub attribute_name: &'a str,
}

#[derive(Debug)]
pub enum DynamoDbUtilError {
    GetItemFailure(Box<DynamoDbSdkError<GetItemError>>),
    BatchGetItemFailure(Box<DynamoDbSdkError<BatchGetItemError>>),
    PutItemFailure(Box<DynamoDbSdkError<PutItemError>>),
    UpdateItemFailure(Box<DynamoDbSdkError<UpdateItemError>>),
    AttributeValueConversionFailure(AttributeValue),
    OperationConstructionFailure(BuildError),
    LocalError(String),
}

impl From<DynamoDbSdkError<GetItemError>> for DynamoDbUtilError {
    fn from(err: DynamoDbSdkError<GetItemError>) -> Self {
        Self::GetItemFailure(Box::new(err))
    }
}

impl From<DynamoDbSdkError<BatchGetItemError>> for DynamoDbUtilError {
    fn from(err: DynamoDbSdkError<BatchGetItemError>) -> Self {
        Self::BatchGetItemFailure(Box::new(err))
    }
}

impl From<DynamoDbSdkError<PutItemError>> for DynamoDbUtilError {
    fn from(err: DynamoDbSdkError<PutItemError>) -> Self {
        Self::PutItemFailure(Box::new(err))
    }
}

impl From<DynamoDbSdkError<UpdateItemError>> for DynamoDbUtilError {
    fn from(err: DynamoDbSdkError<UpdateItemError>) -> Self {
        Self::UpdateItemFailure(Box::new(err))
    }
}

impl From<BuildError> for DynamoDbUtilError {
    fn from(err: BuildError) -> Self {
        Self::OperationConstructionFailure(err)
    }
}

impl From<String> for DynamoDbUtilError {
    fn from(err: String) -> Self {
        Self::LocalError(err)
    }
}

// TODO; Either remove the get_item_from_key and get_batch_item_from_key methods
// or have both of these methods re-use the same internal code and the equivalen *_keys method.
// They don't both need to exist
#[async_trait]
pub trait DynamoDbUtil {
    async fn get_item_from_key(
        &self,
        table_name: &str,
        table_primary_key: &str,
        key: String,
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;

    async fn get_item_from_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;

    async fn batch_get_item_from_key<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
    ) -> Result<Vec<HashMap<String, AttributeValue>>, DynamoDbUtilError>;

    async fn batch_get_item_from_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<Vec<KeyAndAttribute<'a>>>,
    ) -> Result<Vec<HashMap<String, AttributeValue>>, DynamoDbUtilError>;

    async fn put_item_from_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;

    async fn update_item_with_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
        update_expression: String,
        return_value: ReturnValue,
        expression_attribute_names: Option<Vec<KeyAndAttributeName<'a>>>,
        expression_attribute_values: Vec<KeyAndAttribute<'a>>,
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;
}

#[async_trait]
impl DynamoDbUtil for DynamoDbClient {
    async fn get_item_from_key(
        &self,
        table_name: &str,
        table_primary_key: &str,
        key: String,
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let get_item_request = self
            .get_item()
            .table_name(table_name)
            .key(table_primary_key, AttributeValue::S(key));

        Ok(get_item_request.send_request().await?)
    }

    async fn get_item_from_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let mut get_item_request = self.get_item().table_name(table_name);

        for key_and_attribute in keys_and_attributes {
            get_item_request =
                get_item_request.key(key_and_attribute.key, key_and_attribute.attribute);
        }

        Ok(get_item_request.send_request().await?)
    }

    ///
    /// Built to only allow for batch requests on a single dynamo table.
    /// A refactor would need to be done to fetch from multiple tables in one query.
    ///
    async fn batch_get_item_from_key<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
    ) -> Result<Vec<HashMap<String, AttributeValue>>, DynamoDbUtilError> {
        // Create BatchGetItem object that will be used in the request
        let mut batch_get_keys_and_attributes = KeysAndAttributes::builder();
        for key_and_attribute in keys_and_attributes {
            batch_get_keys_and_attributes = batch_get_keys_and_attributes.keys(HashMap::from([(
                key_and_attribute.key.to_owned(),
                key_and_attribute.attribute,
            )]));
        }
        let batch_get_keys_and_attributes = batch_get_keys_and_attributes.build()?;

        let batch_get_item_request = self
            .batch_get_item()
            .request_items(table_name, batch_get_keys_and_attributes);

        Ok(batch_get_item_request
            .send_request()
            .await?
            .remove(table_name) // Remove transfers ownership so the Vec doesn't have to be copied. Probably not necessary but feels cleaner
            .ok_or_else(|| "The desired table name returned no responses".to_owned())?)
    }

    async fn batch_get_item_from_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<Vec<KeyAndAttribute<'a>>>,
    ) -> Result<Vec<HashMap<String, AttributeValue>>, DynamoDbUtilError> {
        // Create BatchGetItem object for each set of keys
        let mut batch_get_keys_and_attributes = KeysAndAttributes::builder();
        for key_and_attribute_list in keys_and_attributes {
            let key_and_attribute_map = build_multi_key_and_attribute_map(key_and_attribute_list);

            batch_get_keys_and_attributes =
                batch_get_keys_and_attributes.keys(key_and_attribute_map);
        }
        let batch_get_keys_and_attributes = batch_get_keys_and_attributes.build()?;

        let batch_get_item_request = self
            .batch_get_item()
            .request_items(table_name, batch_get_keys_and_attributes);

        Ok(batch_get_item_request
            .send_request()
            .await?
            .remove(table_name) // Remove transfers ownership so the Vec doesn't have to be copied. Probably not necessary but feels cleaner
            .ok_or_else(|| "The desired table name returned no responses".to_owned())?)
    }

    async fn put_item_from_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let mut put_item_request = self.put_item().table_name(table_name);
        for key_and_attribute in keys_and_attributes {
            put_item_request =
                put_item_request.item(key_and_attribute.key, key_and_attribute.attribute);
        }
        let put_item_request = put_item_request;

        Ok(put_item_request.send_request().await?)
    }

    async fn update_item_with_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
        update_expression: String,
        return_value: ReturnValue,
        expression_attribute_names: Option<Vec<KeyAndAttributeName<'a>>>,
        expression_attribute_values: Vec<KeyAndAttribute<'a>>,
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let mut update_item_request = self
            .update_item()
            .table_name(table_name)
            .update_expression(update_expression)
            .return_values(return_value);

        // Set the keys to be queried on
        for key_and_attribute in keys_and_attributes {
            update_item_request =
                update_item_request.key(key_and_attribute.key, key_and_attribute.attribute);
        }

        // Set the expression attribute names used in teh update expression
        if let Some(names) = expression_attribute_names {
            for key_and_attribute in names {
                update_item_request = update_item_request.expression_attribute_names(
                    key_and_attribute.key,
                    key_and_attribute.attribute_name,
                );
            }
        }

        // Set the expression attribute values used in the update expression
        for key_and_attribute in expression_attribute_values {
            update_item_request = update_item_request
                .expression_attribute_values(key_and_attribute.key, key_and_attribute.attribute)
        }

        Ok(update_item_request.send_request().await?)
    }
}

// Helper Functions
fn build_multi_key_and_attribute_map(
    key_and_attribute_list: Vec<KeyAndAttribute>,
) -> HashMap<String, AttributeValue> {
    let mut key_and_attribute_map = HashMap::new();

    for key_and_attribute in key_and_attribute_list {
        key_and_attribute_map.insert(
            key_and_attribute.key.to_owned(),
            key_and_attribute.attribute,
        );
    }

    

    key_and_attribute_map
}

// Overidden Send Functions
#[async_trait]
trait DynamoDbSend {
    async fn send_request(self) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;
}

#[async_trait]
trait BatchDynamoDbSend {
    async fn send_request(
        self,
    ) -> Result<HashMap<String, Vec<HashMap<String, AttributeValue>>>, DynamoDbUtilError>;
}

#[async_trait]
impl DynamoDbSend for GetItemFluentBuilder {
    async fn send_request(self) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let get_item_result = self.send().await?;

        let item = get_item_result
            .item()
            .ok_or_else(|| "Getting the set object failed".to_owned())?;

        Ok(item.to_owned())
    }
}

#[async_trait]
impl DynamoDbSend for UpdateItemFluentBuilder {
    async fn send_request(self) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let update_item_result = self.send().await?;

        let attributes = update_item_result
            .attributes()
            .ok_or_else(|| "Updating the item failed".to_owned())?;

        Ok(attributes.to_owned())
    }
}

#[async_trait]
impl DynamoDbSend for PutItemFluentBuilder {
    async fn send_request(self) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let put_item_result = self.send().await?;

        let attributes = put_item_result
            .attributes()
            .map_or(HashMap::<String, AttributeValue>::default(), |attributes| {
                attributes.to_owned()
            });

        Ok(attributes)
    }
}

#[async_trait]
impl BatchDynamoDbSend for BatchGetItemFluentBuilder {
    async fn send_request(
        self,
    ) -> Result<HashMap<String, Vec<HashMap<String, AttributeValue>>>, DynamoDbUtilError> {
        let batch_get_item_result = self.send().await?;

        let table_to_list_of_attributes = batch_get_item_result
            .responses()
            .ok_or_else(|| "Updating the item failed".to_owned())?;

        Ok(table_to_list_of_attributes.to_owned())
    }
}
