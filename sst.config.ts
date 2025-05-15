/// <reference path="./.sst/platform/config.d.ts" />

import { access } from "fs";

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
        readCapacity: 15,
        writeCapacity: 15,
      },
    },
  });

  const notifyQueueDlq = new sst.aws.Queue("NotifyQueueDlq");
  const notifyQueue = new sst.aws.Queue("NotifyQueue", {
    dlq: notifyQueueDlq.arn,
  });

  const {
    baseBucket: initialUploadBucket,
    backendBucketLink: initialUploadBucketBackendLink,
    postProcessBucketLink: initialUploadBucketPostProcessLink,
  } = await createInitialUploadBucket();
  const {
    baseBucket: viewableBucket,
    postProcessBucketLink: viewableBucketPostProcessLink,
  } = await createViewableImagesBucket();
  initialUploadBucket.notify({
    notifications: [
      {
        name: "Subscriber",
        queue: notifyQueue,
        events: ["s3:ObjectCreated:*"],
      },
    ],
  });
  // TODO: Add a processor on the DLQ to check the state of the object and make
  // some decision about whether or not the user should be notified
  notifyQueue.subscribe(
    {
      handler: "packages/mobile-backend/processor.handler",
      link: [
        initialUploadBucketPostProcessLink,
        viewableBucketPostProcessLink,
        userTable,
      ],
    },
    {
      batch: {
        partialResponses: true,
      },
    },
  );

  const backendFunction = new sst.aws.Function("BackendFunction", {
    handler: "packages/mobile-backend/index.handler",
    url: true,
    link: [
      initialUploadBucketBackendLink,
      userTable,
      authTokenSecret,
      refreshTokenSecret,
    ],
  });

  const backendDomain =
    $app.stage === "production"
      ? "mobile.jtken.com"
      : `${$app.stage}.mobile.jtken.com`;
  const router = new sst.aws.Router("BackendRouter", {
    domain: backendDomain,
  });
  router.route("/", backendFunction.url);
}

async function createInitialUploadBucket(): Promise<{
  baseBucket: sst.aws.Bucket;
  backendBucketLink: sst.Linkable;
  postProcessBucketLink: sst.Linkable;
}> {
  const initialUploadBucket = new sst.aws.Bucket("InitialUploadBucket");
  const initialUploadBackend = new sst.Linkable("InitialUploadBucketBackend", {
    properties: {
      name: initialUploadBucket.name,
    },
    include: [
      sst.aws.permission({
        actions: ["s3:PutObject"],
        resources: [
          initialUploadBucket.arn,
          $interpolate`${initialUploadBucket.arn}/*`,
        ],
      }),
    ],
  });
  const initiaulUploadPostProcess = new sst.Linkable(
    "InitialUploadPostProcess",
    {
      properties: {
        name: initialUploadBucket.name,
      },
      include: [
        sst.aws.permission({
          actions: [
            "s3:GetObject",
            "s3:PutObjectTagging",
            "s3:GetObjectTagging",
          ],
          resources: [
            initialUploadBucket.arn,
            $interpolate`${initialUploadBucket.arn}/*`,
          ],
        }),
      ],
    },
  );

  return {
    baseBucket: initialUploadBucket,
    backendBucketLink: initialUploadBackend,
    postProcessBucketLink: initiaulUploadPostProcess,
  };
}

async function createViewableImagesBucket(): Promise<{
  baseBucket: sst.aws.Bucket;
  postProcessBucketLink: sst.Linkable;
}> {
  const viewableImageBucket = new sst.aws.Bucket("ViewableBucket", {
    access: "cloudfront",
  });
  const viewablePostProcess = new sst.Linkable("ViewableBucketPostProcess", {
    properties: {
      name: viewableImageBucket.name,
    },
    include: [
      sst.aws.permission({
        actions: ["s3:PutObject"],
        resources: [
          viewableImageBucket.arn,
          $interpolate`${viewableImageBucket.arn}/*`,
        ],
      }),
    ],
  });

  return {
    baseBucket: viewableImageBucket,
    postProcessBucketLink: viewablePostProcess,
  };
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
