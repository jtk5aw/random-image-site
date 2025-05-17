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
          profile:
            input.stage === "production" ? "jackson-production" : "jackson-dev",
          version: "6.66.2",
          region: "us-west-1",
        },
      },
    };
  },
  async run() {
    // Override links
    sst.Linkable.wrap(sst.aws.Dynamo, (table) => ({
      properties: {
        name: table.name,
        primaryKey: table.nodes.table.hashKey,
        sortKey: table.nodes.table.rangeKey,
      },
      include: [
        sst.aws.permission({
          actions: ["dynamodb:*"],
          resources: [table.arn],
        }),
      ],
    }));

    // Shared resources
    const {
      baseBucket: viewableBucket,
      postProcessBucketLink: viewableBucketPostProcessLink,
      listOnlyBucketLink: viewableBucketListOnlyLink,
    } = await createViewableImagesBucket();
    const { imageTable } = await createImageTable();

    // Infra functions
    await mobileApi(viewableBucket, viewableBucketPostProcessLink);
    await backgroundEvents(imageTable, viewableBucketListOnlyLink);
  },
});

async function backgroundEvents(
  imageTable: sst.Dynamo,
  viewableBucketListOnlyLink: sst.Linkable,
) {
  new sst.aws.Cron("DailySetupCron", {
    function: {
      handler: "./backend.daily_setup_lambda",
      runtime: "rust",
      architecture: "arm64",
      memory: "128 MB",
      link: [imageTable, viewableBucketListOnlyLink],
    },
    schedule: "cron(0 22 * * ? *)",
  });
}

async function mobileApi(
  viewableBucket: sst.Bucket,
  viewableBucketPostProcessLink: sst.Linkable,
) {
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
        readCapacity: $app.stage === "production" ? 15 : 5,
        writeCapacity: $app.stage === "production" ? 15 : 5,
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

  // TODO TODO TODO: Move over the website infra into this SST. First deploy
  // it into beta to test. Then, deploy the prod stage. Move all the data
  // over from the management account when ready and then delete the resources
  // that exist in the management account. For now the blog will remain
  // but everything else should be removable

  // WARNING: Because the DNS is in the management account,
  // the Route53 records have to be setup manually and the referenced
  // certifiates have to be setup manually as well. This includes anything
  // needed to get subdomains working as well
  const backendDomain =
    $app.stage === "production" ? "jtken.com" : `${$app.stage}.jtken.com`;
  const router = new sst.aws.Router("MyRouter", {
    domain: {
      name: backendDomain,
      dns: false,
      cert:
        $app.stage === "production"
          ? "arn:aws:acm:us-east-1:043573420511:certificate/014a365d-6215-4f0c-a2b4-ab3765918952"
          : "arn:aws:acm:us-east-1:126982764781:certificate/82b971ea-2df3-4ac4-ab7b-e0bfc5f218fc",
      aliases: [`*.${backendDomain}`],
    },
  });
  router.route(`mobile.${backendDomain}/`, backendFunction.url);
  router.routeBucket(`img.${backendDomain}`, viewableBucket);
}

async function createImageTable(): Promise<{ imageTable: sst.aws.Dynamo }> {
  const imageTable = new sst.aws.Dynamo("ImageTable", {
    fields: {
      pk: "string",
      sk: "string",
    },
    primaryIndex: { hashKey: "pk", rangeKey: "sk" },
    transform: {
      table: {
        billingMode: "PROVISIONED",
        readCapacity: $app.stage === "production" ? 15 : 5,
        writeCapacity: $app.stage === "production" ? 15 : 5,
      },
    },
  });

  return {
    imageTable,
  };
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
  listOnlyBucketLink: sst.Linkable;
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
  const viewableListOnly = new sst.Linkable("ViewableBucketListOnly", {
    properties: {
      name: viewableImageBucket.name,
    },
    include: [
      sst.aws.permission({
        actions: ["s3:ListBucket"],
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
    listOnlyBucketLink: viewableListOnly,
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
