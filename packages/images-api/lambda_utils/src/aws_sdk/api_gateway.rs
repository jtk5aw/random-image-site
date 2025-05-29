use aws_lambda_events::event::apigw::ApiGatewayV2httpRequest;
use aws_lambda_events::{
    encodings::Body,
    event::apigw::{ApiGatewayProxyResponse, ApiGatewayV2httpResponse},
    http::HeaderMap,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;

/**
 * Struct used to create API Gateway response headers.
 */
pub struct ApiGatewayProxyResponseWithoutHeaders {
    pub status_code: i64,
    pub body: Body,
    pub is_base_64_encoded: bool,
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
            is_base64_encoded: self.is_base_64_encoded,
        }
    }

    pub fn build_v2_response(self) -> ApiGatewayV2httpResponse {
        ApiGatewayV2httpResponse {
            status_code: self.status_code,
            headers: create_cross_origin_headers(),
            multi_value_headers: HeaderMap::new(),
            body: Some(self.body),
            is_base64_encoded: self.is_base_64_encoded,
            cookies: Vec::new(),
        }
    }
}

fn create_cross_origin_headers() -> HeaderMap {
    let mut header_map = HeaderMap::new();
    header_map.insert("Access-Control-Allow-Origin", "*".parse().unwrap());
    header_map
}

/**
 * Extracts the body from an API Gateway V2 HTTP request, handling base64 decoding if necessary.
 *
 * # Arguments
 *
 * * `req` - The API Gateway V2 HTTP request with the body to extract
 *
 * # Returns
 *
 * A Result containing either the decoded body as a String, or an error message if the body
 * could not be extracted or decoded.
 */
pub fn extract_body_from_request(req: &ApiGatewayV2httpRequest) -> Result<String, String> {
    match &req.body {
        Some(body) => {
            if req.is_base64_encoded {
                // Decode base64 body using the modern API
                let decoded_bytes = BASE64
                    .decode(body)
                    .map_err(|e| format!("Failed to decode base64 body: {}", e))?;

                // Convert bytes to UTF-8 string
                String::from_utf8(decoded_bytes)
                    .map_err(|e| format!("Failed to convert decoded body to UTF-8: {}", e))
            } else {
                Ok(body.clone())
            }
        }
        None => Err("Body does not exist".to_owned()),
    }
}
