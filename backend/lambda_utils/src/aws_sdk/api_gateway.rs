use aws_lambda_events::{encodings::Body, event::apigw::ApiGatewayProxyResponse};
use http::header::HeaderMap;

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