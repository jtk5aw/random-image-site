/// <reference path="./.sst/platform/config.d.ts" />

import { access } from "fs";

// TODO: All the types in this file aren't autocompleted so a lot of them are
// wrong (e.g sst.Bucket vs sst.aws.Bucket) this should be fixed

// TODO: It should be able to set up the Route53 stuff in here with manually
// written code. Only problem is in Prod it would require running SST against two accounts. Unsure if that's supported out of the box

// TODO: Try to see if its possible to protect API GW v2 by
// only allowing calls originating from CloudFront distribution.

interface MyRouter {
  router: sst.aws.Router;
  backendDomain: string;
}

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

    // WARNING: Because the DNS is in the management account,
    // the Route53 records have to be setup manually and the referenced
    // certifiates have to be setup manually as well. This includes anything
    // needed to get subdomains working as well
    const backendDomain =
      $app.stage === "production"
        ? "prod.jtken.com"
        : `${$app.stage}.jtken.com`;
    console.log(`Backend domain is: ${backendDomain}`);
    const router = new sst.aws.Router("MyRouter", {
      domain: {
        name: backendDomain,
        dns: false,
        cert:
          $app.stage === "production"
            ? "arn:aws:acm:us-east-1:043573420511:certificate/0c598c26-b453-47a2-bd13-027050d43ccc"
            : "arn:aws:acm:us-east-1:126982764781:certificate/82b971ea-2df3-4ac4-ab7b-e0bfc5f218fc",
        aliases: [`*.${backendDomain}`],
      },
    });
    const myRouter: MyRouter = {
      router,
      backendDomain,
    };

    // Infra functions
    await imageSite(myRouter);
    await imageApi(myRouter, imageTable);
    await mobileApi(myRouter, viewableBucket, viewableBucketPostProcessLink);
    await backgroundEvents(imageTable, viewableBucketListOnlyLink);
  },
});

async function imageSite(myRouter: MyRouter) {
  // WARNING: Right now this requires that a build has already happened
  const imageSite = new sst.aws.StaticSite("ImageSite", {
    path: "packages/images-frontend",
    build: {
      command: "npm run build", // This command runs every deploy
      output: "dist", // This directory is uploaded after build
    },
    router: {
      instance: myRouter.router,
    },
    environment: {
      VITE_API_URL: `https://api.${myRouter.backendDomain}`,
    },
    dev: {
      command: "npm run dev", // Updated to Vite dev command
    },
  });
}

async function imageApi(myRouter: MyRouter, imageTable: sst.aws.Dynamo) {
  const imageApi = new sst.aws.ApiGatewayV2("ImageApi");

  imageApi.route("GET /todays-image", {
    handler: "./packages/images-api.get_image_lambda",
    runtime: "rust",
    architecture: "arm64",
    memory: "128 MB",
    environment: {
      // TODO: make this a constant somehow so it's not defined twice.
      // or maybe a function on myRouter
      IMAGE_DOMAIN: `img.${myRouter.backendDomain}`,
    },
    link: [imageTable],
  });
  imageApi.route("GET /todays-metadata", {
    handler: "./packages/images-api.get_or_set_reaction_lambda",
    runtime: "rust",
    architecture: "arm64",
    memory: "128 MB",
    link: [imageTable],
  });
  imageApi.route("PUT /todays-metadata", {
    handler: "./packages/images-api.get_or_set_reaction_lambda",
    runtime: "rust",
    architecture: "arm64",
    memory: "128 MB",
    link: [imageTable],
  });
  imageApi.route("PUT /set-favorite", {
    handler: "./packages/images-api.set_favorite_recent_lambda",
    runtime: "rust",
    architecture: "arm64",
    memory: "128 MB",
    link: [imageTable],
  });

  myRouter.router.route(`api.${myRouter.backendDomain}`, imageApi.url);
}

async function backgroundEvents(
  imageTable: sst.aws.Dynamo,
  viewableBucketListOnlyLink: sst.Linkable,
) {
  new sst.aws.Cron("DailySetupCron", {
    function: {
      handler: "./packages/images-api.daily_setup_lambda",
      runtime: "rust",
      architecture: "arm64",
      memory: "128 MB",
      link: [imageTable, viewableBucketListOnlyLink],
    },
    schedule: "cron(0 22 * * ? *)",
  });
}

async function mobileApi(
  myRouter: MyRouter,
  viewableBucket: sst.aws.Bucket,
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

  myRouter.router.route(
    `mobile.${myRouter.backendDomain}/`,
    backendFunction.url,
  );
  myRouter.router.routeBucket(`img.${myRouter.backendDomain}`, viewableBucket);
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
