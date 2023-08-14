import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

interface BaseProps {
    bucket_name: string;
    image_domain: string;
    table_name: string;
    table_primary_key: string;
    random_image_site_table_name: string,
    random_image_site_primary_key: string,
    random_image_site_sort_key: string,
    user_reaction_table_name: string;
    user_reaction_table_primary_key: string;
    user_reaction_table_sort_key: string;
}

const BACKEND_BASE_DIR = '../backend/target/lambda/'

function getLambdaPath(lambdaName: string) {
  return `${BACKEND_BASE_DIR}${lambdaName}/`;
}

export function constructApi(scope: Construct, props: BaseProps) {
    // Compute
    const handler = new lambda.Function(scope, 'GetImageLambda', {
        functionName: 'GetImageLambda',
        code: lambda.Code.fromAsset(
          getLambdaPath('get_image_lambda'),
        ),
        runtime: lambda.Runtime.PROVIDED_AL2,
        architecture: lambda.Architecture.ARM_64,
        handler: 'not.required',
        environment: {
          RUST_BACKTRACE: '1',
          IMAGE_DOMAIN: props.image_domain,
          TABLE_NAME: props.random_image_site_table_name,
          TABLE_PRIMARY_KEY: props.random_image_site_primary_key,
          TABLE_SORT_KEY: props.random_image_site_sort_key,
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
          getLambdaPath('get_or_set_reaction_lambda'),
        ),
        runtime: lambda.Runtime.PROVIDED_AL2,
        architecture: lambda.Architecture.ARM_64,
        handler: 'not.required',
        environment: {
          RUST_BACKTRACE: '1',
          TABLE_NAME: props.random_image_site_table_name,
          TABLE_PRIMARY_KEY: props.random_image_site_primary_key,
          TABLE_SORT_KEY: props.random_image_site_sort_key,
        }
      });
  
      getOrSetMetadataHandler.addToRolePolicy(new PolicyStatement({
        actions:['dynamodb:*'],
        resources: ['*'],
      }));

      const setFavoriteRecentHandler = new lambda.Function(scope, 'SetFavoriteRecentLambda', {
        functionName: 'SetFavoriteRecentLambda',
        code: lambda.Code.fromAsset(
          getLambdaPath('set_favorite_recent_lambda'),
        ),
        runtime: lambda.Runtime.PROVIDED_AL2,
        architecture: lambda.Architecture.ARM_64,
        handler: 'not.required',
        environment: {
          RUST_BACKTRACE: '1',
          TABLE_NAME: props.random_image_site_table_name,
          TABLE_PRIMARY_KEY: props.random_image_site_primary_key,
          TABLE_SORT_KEY: props.random_image_site_sort_key,
        }
      });
  
      setFavoriteRecentHandler.addToRolePolicy(new PolicyStatement({
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

      const setFavorite = randomImageApi.root.addResource('set-favorite');
      setFavorite.addMethod('PUT', new apiGateway.LambdaIntegration(setFavoriteRecentHandler));
}

type EventProps = Omit<BaseProps, "image_domain">;

export function constructEvents(scope: Construct, props: EventProps) {
  const dailySetupHandler = new lambda.Function(scope, 'DailySetupLambda', {
    functionName: 'DailySetupLambda',
    code: lambda.Code.fromAsset(
      getLambdaPath('daily_setup_lambda'),
    ),
    runtime: lambda.Runtime.PROVIDED_AL2,
    architecture: lambda.Architecture.ARM_64,
    handler: 'not.required',
    environment: {
      RUST_BACKTRACE: '1',
      BUCKET_NAME: props.bucket_name,
      TABLE_NAME: props.random_image_site_table_name,
      TABLE_PRIMARY_KEY: props.random_image_site_primary_key,
      TABLE_SORT_KEY: props.random_image_site_sort_key,
    }
  });

  dailySetupHandler.addToRolePolicy(new PolicyStatement({
    actions: ['s3:*'],
    resources: ['*']
  }));

  dailySetupHandler.addToRolePolicy(new PolicyStatement({
    actions:['dynamodb:*'],
    resources: ['*'],
  }));


  const dailyEvent = new events.Rule(scope, 'DailySetupRule', {
    description: 'Triggers the daily setup lambda for tomorrow',
    enabled: true,
    schedule: events.Schedule.cron({
      minute: '0',
      hour: '22',
    }),
  });

  dailyEvent.addTarget(new targets.LambdaFunction(dailySetupHandler, {
    maxEventAge: Duration.hours(2),
    retryAttempts: 2,
  }))
}