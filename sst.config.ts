/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "random-image-site",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          version: "6.66.2",
          region: "us-west-1",
        },
      },
    };
  },
  async run() {
    await discordBot($app);
    await mobileApi();
  },
});

async function mobileApi() {
  const authTokenSecret = new sst.Secret("AuthTokenSecret");
  const refreshTokenSecret = new sst.Secret("RefreshTokenSecret");
  const userTable = new sst.aws.Dynamo("UserTable", {
    fields: {
      pk: "string",
      sk: "string",
    },
    primaryIndex: { hashKey: "pk", rangeKey: "sk" },
    transform: {
      table: {
        billingMode: "PROVISIONED",
        readCapacity: 20,
        writeCapacity: 20,
      },
    },
  });

  const bucket = new sst.aws.Bucket("InitialUploadBucket");

  const backendFunction = new sst.aws.Function("BackendFunction", {
    handler: "packages/mobile-backend/index.handler",
    url: true,
    link: [bucket, userTable, authTokenSecret, refreshTokenSecret],
  });
}

async function discordBot(app: any) {
  // NOTE: Currently requires that the discord_api_token be created manually. There is no other CDK stack creating it
  // The s3 bucket on the other hand is created in a separate cdk stack
  // Constants
  const bucket_name = "get-image-lambda-bucket";
  const secret_name = "discord_api_token";

  const vpc = new sst.aws.Vpc("DiscordBot2Vpc");
  const s3Endpoint = new aws.ec2.VpcEndpoint("DiscordBot2S3Endpoint", {
    vpcId: vpc.id,
    serviceName: "com.amazonaws.us-west-1.s3",
  });

  const cluster = new sst.aws.Cluster("DiscordBot2Cluster", { vpc });
  // By default builds a docker image from the dockerfile in the root directory
  cluster.addService("DiscordBot2Service", {
    architecture: "arm64",
    image: {
      context: ".",
      dockerfile: "Dockerfile",
    },
    scaling: {
      min: $app.stage == "production" ? 1 : 0,
      max: 1,
    },
    permissions: [
      {
        actions: ["s3:*"],
        resources: [
          `arn:aws:s3:::${bucket_name}*`,
          `arn:aws:s3:::${bucket_name}/*`,
        ],
      },
      {
        actions: [
          "secretsmanager:GetResourcePolicy",
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListSecretVersionIds",
        ],
        resources: [
          `arn:aws:secretsmanager:us-west-1:961305444646:secret:${secret_name}*`,
        ],
      },
    ],
  });
}
