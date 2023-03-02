use std::collections::HashMap;

use aws_sdk_dynamodb::{Client as DynamoDbClient, error::GetItemError, model::AttributeValue};
use aws_sdk_dynamodb::types::SdkError as DynamoDbSdkError;
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
            is_base64_encoded: Some(self.is_base_64_encoded)
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
#[derive(Debug)]
pub enum DynamoDbUtilError {
    GetItemFailure(Box<DynamoDbSdkError<GetItemError>>),
    AttributeValueConversionFailure(AttributeValue),
    LocalError(String),
}

impl From<DynamoDbSdkError<GetItemError>> for DynamoDbUtilError {
    fn from(err: DynamoDbSdkError<GetItemError>) -> Self {
        Self::GetItemFailure(Box::new(err))
    }
}

impl From<AttributeValue> for DynamoDbUtilError {
    fn from(err: AttributeValue) -> Self {
        Self::AttributeValueConversionFailure(err)
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
}

#[async_trait]
impl DynamoDbUtil for DynamoDbClient {
    async fn get_item_from_key(
        &self,
        table_name: &str,
        table_primary_key: &str,
        key: String
    ) -> Result<HashMap<String, AttributeValue>, DynamoDbUtilError> {

        let get_item_result = self
            .get_item()
            .table_name(table_name)
            .key(table_primary_key, AttributeValue::S(key))
            .send()
            .await?;

        let item = get_item_result
            .item()
            .ok_or_else(|| "Getting the set object failed".to_owned())?;

        Ok(item.to_owned())
    }
}