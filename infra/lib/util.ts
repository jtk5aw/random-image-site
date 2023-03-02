import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

interface ApiProps {
    bucket_name: string;
    table_name: string;
    table_primary_key: string;
}

export function constructApi(scope: Construct, props: ApiProps) {
    // Compute
    const handler = new lambda.Function(scope, 'GetImageLambda', {
        functionName: 'GetImageLambda',
        code: lambda.Code.fromAsset(
          '..\\get-image-lambda\\target\\x86_64-unknown-linux-musl\\release\\lambda'
        ),
        runtime: lambda.Runtime.PROVIDED_AL2,
        handler: 'not.required',
        environment: {
          RUST_BACKTRACE: '1',
          BUCKET_NAME: props.bucket_name,
          TABLE_NAME: props.table_name,
          TABLE_PRIMARY_KEY: props.table_primary_key,
        }
      });
  
      handler.addToRolePolicy(new PolicyStatement({
        actions: ['s3:*'],
        resources: ['*']
      }));
  
      handler.addToRolePolicy(new PolicyStatement({
        actions:['dynamodb:*'],
        resources: ['*'],
      }));
  
      const getOrSetMetadataHandler = new lambda.Function(scope, 'GetOrSetMetadataLambda', {
        functionName: 'GetOrSetMetadataLambda',
        code: lambda.Code.fromAsset(
          '..\\get-or-set-reaction-lambda\\target\\x86_64-unknown-linux-musl\\release\\lambda'
        ),
        runtime: lambda.Runtime.PROVIDED_AL2,
        handler: 'not.required',
        environment: {
          RUST_BACKTRACE: '1',
          TABLE_NAME: props.table_name,
          TABLE_PRIMARY_KEY: props.table_primary_key,
        }
      });
  
      handler.addToRolePolicy(new PolicyStatement({
        actions:['dynamodb:*'],
        resources: ['*'],
      }));
  
      // API Gateway
      const randomImageApi = new apiGateway.RestApi(scope, 'RandomImageAPI', {
        restApiName: 'random-image-api',
        defaultCorsPreflightOptions: {
          allowOrigins: apiGateway.Cors.ALL_ORIGINS,
          allowMethods: apiGateway.Cors.ALL_METHODS,
        }
      });
  
      const todaysImage = randomImageApi.root.addResource('todays-image');
      todaysImage.addMethod('GET', new apiGateway.LambdaIntegration(handler));
  
      const todaysMetadata = randomImageApi.root.addResource('todays-metadata');
      todaysMetadata.addMethod('GET', new apiGateway.LambdaIntegration(getOrSetMetadataHandler));
      todaysMetadata.addMethod('PUT', new apiGateway.LambdaIntegration(getOrSetMetadataHandler));
}