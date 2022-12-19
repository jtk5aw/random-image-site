import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Constants
    const bucket_name = 'get-image-lambda-bucket';
    const table_name = 'image-info-table';
    const table_primary_key = 'id';
    
    // Storage resources
    const bucket = new s3.Bucket(this, "TestBucket", {
      bucketName: bucket_name,
      publicReadAccess: false,
    });

    const imageInfoTable = new cdk.aws_dynamodb.Table(this, 'ImageInfoTable', {
      tableName: table_name,
      partitionKey: { name: table_primary_key, type: cdk.aws_dynamodb.AttributeType.STRING },
      billingMode: cdk.aws_dynamodb.BillingMode.PROVISIONED
    });

    imageInfoTable.autoScaleReadCapacity({
      minCapacity: 1, 
      maxCapacity: 3,
    });

    imageInfoTable.autoScaleWriteCapacity({
      minCapacity: 1, 
      maxCapacity: 3,
    });

    // Compute
    const handler = new lambda.Function(this, 'GetImageLambda', {
      functionName: 'GetImageLambda',
      code: lambda.Code.fromAsset(
        '..\\get-image-lambda\\target\\x86_64-unknown-linux-musl\\release\\lambda'
      ),
      runtime: lambda.Runtime.PROVIDED_AL2,
      handler: 'not.required',
      environment: {
        RUST_BACKTRACE: '1',
        BUCKET_NAME: bucket_name,
        TABLE_NAME: table_name,
        TABLE_PRIMARY_KEY: table_primary_key,
      }
    });

    handler.addToRolePolicy(new PolicyStatement({
      actions: ['s3:*'],
      resources: ['*']
    }));

    handler.addToRolePolicy(new PolicyStatement({
      actions:['dynamodb:*'],
      resources: ['*'],
    }))

    // API Gateway
    const randomImageApi = new apiGateway.RestApi(this, 'RandomImageAPI', {
      restApiName: 'random-image-api'
    });

    const todaysImage = randomImageApi.root.addResource('todays-image');
    todaysImage.addMethod('GET', new apiGateway.LambdaIntegration(handler));

  }
}
