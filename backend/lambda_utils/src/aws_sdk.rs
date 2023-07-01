use std::collections::HashMap;

use aws_sdk_dynamodb::{Client as DynamoDbClient, types::{AttributeValue, ReturnValue}, operation::{get_item::{GetItemError, builders::GetItemFluentBuilder}, update_item::{UpdateItemError, builders::UpdateItemFluentBuilder}}, error::SdkError as DynamoDbSdkError};
use aws_lambda_events::{encodings::Body, event::apigw::ApiGatewayProxyResponse};
use http::header::{HeaderMap};
use async_trait::async_trait;

/**
 * Struct used to create API Gateway response headers. 
 */
pub struct ApiGatewayProxyResponseWithoutHeaders {
    pub status_code: i64,
    pub body: Body,
    pub is_base_64_encoded: bool
}

/**
 * Creates an API Gateway response with headers that will allow cross origin requests.
 */
impl ApiGatewayProxyResponseWithoutHeaders {
    pub fn build_full_response(self) -> ApiGatewayProxyResponse {
        ApiGatewayProxyResponse { 
            status_code: self.status_code, 
            headers: create_cross_origin_headers(), 
            multi_value_headers: HeaderMap::new(), 
            body: Some(self.body), 
            is_base64_encoded: self.is_base_64_encoded
        }
    }
}

fn create_cross_origin_headers() -> HeaderMap {
    let mut header_map = HeaderMap::new();
    header_map.insert("Access-Control-Allow-Origin", "*".parse().unwrap());
    header_map
}

/** 
 * Util Functions for making calls to DynamoDB
 */
pub struct KeyAndAttribute<'a> {
    pub key: &'a str,
    pub attribute: AttributeValue
}

pub struct KeyAndAttributeName<'a> {
    pub key: &'a str,
    pub attribute_name: &'a str
}

#[derive(Debug)]
pub enum DynamoDbUtilError {
    GetItemFailure(Box<DynamoDbSdkError<GetItemError>>),
    UpdateItemFailure(Box<DynamoDbSdkError<UpdateItemError>>),
    AttributeValueConversionFailure(AttributeValue),
    LocalError(String),
}

impl From<DynamoDbSdkError<GetItemError>> for DynamoDbUtilError {
    fn from(err: DynamoDbSdkError<GetItemError>) -> Self {
        Self::GetItemFailure(Box::new(err))
    }
}

impl From<DynamoDbSdkError<UpdateItemError>> for DynamoDbUtilError {
    fn from(err: DynamoDbSdkError<UpdateItemError>) -> Self {
        Self::UpdateItemFailure(Box::new(err))
    }
}

impl From<String> for DynamoDbUtilError {
    fn from(err: String) -> Self {
        Self::LocalError(err)
    }
}

#[async_trait]
pub trait DynamoDbUtil {
    async fn get_item_from_key(
        &self,
        table_name: &str,
        table_primary_key: &str,
        key: String
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;

    async fn get_item_from_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;

    async fn update_item_with_keys<'a>(
        &self,
        table_name: &str,
        keys_and_attributes: Vec<KeyAndAttribute<'a>>,
        update_expression: String,
        return_value: ReturnValue,
        expression_attribute_names: Option<Vec<KeyAndAttributeName<'a>>>,
        expression_attribute_values: Vec<KeyAndAttribute<'a>>
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;
}

#[async_trait]
impl DynamoDbUtil for DynamoDbClient {
    async fn get_item_from_key(
        &self,
        table_name: &str,
        table_primary_key: &str,
        key: String
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
        keys_and_attributes: Vec<KeyAndAttribute<'a>>
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {

        let mut get_item_request = self
            .get_item()
            .table_name(table_name);

        for key_and_attribute in keys_and_attributes {
            get_item_request = get_item_request.key(
                key_and_attribute.key, key_and_attribute.attribute
            );
        }
        
        Ok(get_item_request.send_request().await?)
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
            update_item_request = update_item_request.key(
                key_and_attribute.key, key_and_attribute.attribute
            );
        }
        
        // Set the expression attribute names used in teh update expression
        if let Some(names) = expression_attribute_names {
            for key_and_attribute in names {
                update_item_request = update_item_request.expression_attribute_names(
                    key_and_attribute.key, key_and_attribute.attribute_name
                );
            }
        }

        // Set the expression attribute values used in the update expression
        for key_and_attribute in expression_attribute_values {
            update_item_request = update_item_request.expression_attribute_values(
                key_and_attribute.key, key_and_attribute.attribute
            )
        }

        Ok(update_item_request.send_request().await?)
    }
}

#[async_trait]
trait DynamoDbSend {
    async fn send_request(self) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError>;
}

#[async_trait]
impl DynamoDbSend for GetItemFluentBuilder {
    async fn send_request(self) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let get_item_result = self
            .send()
            .await?;

        let item = get_item_result
            .item()
            .ok_or_else(|| "Getting the set object failed".to_owned())?;

        Ok(item.to_owned())
    } 
}

#[async_trait]
impl DynamoDbSend for UpdateItemFluentBuilder {
    async fn send_request(self) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {
        let update_item_result = self
            .send()
            .await?;
    
        let attributes = update_item_result
            .attributes()
            .ok_or_else(|| "Updating the item failed".to_owned())?;
    
        Ok(attributes.to_owned())
    } 
}
