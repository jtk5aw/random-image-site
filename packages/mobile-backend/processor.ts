import { SQSEvent, SQSBatchItemFailure } from "aws-lambda";
import { z } from "zod";
import {
  S3Client,
  GetObjectCommand,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  PutObjectCommand,
  GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Resource } from "sst";
import { Readable } from "stream";
import sharp from "sharp";

// only validate the nested s3.bucket.name and s3.object.key
const S3RecordSchema = z
  .object({
    s3: z.object({
      bucket: z.object({ name: z.string() }),
      object: z.object({ key: z.string() }),
    }),
  })
  // allow any other props on the record
  .passthrough();

const S3NotificationSchema = z
  .object({ Records: z.array(S3RecordSchema) })
  .passthrough();

// DDB Config
const USER_GROUP_SK = "user_group_sk";

// Process state tags
const STATE_TAG_KEY = "state";
const STATE_NOT_IMAGE = "NOT_IMAGE";
const STATE_FAILED = "FAILED";
const STATE_SUCCESSFUL = "SUCCESSFUL";
const STATE_NOT_AUTHORIZED = "NOT_AUTHORIZED";

// Configuration
const MAX_HEIGHT = 1000;
const OUTPUT_FORMAT = "webp";
const OUTPUT_BUCKET = Resource.ViewableBucketPostProcess.name;

/**
 * Stream to buffer helper function to convert S3 stream response to Buffer
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Checks if an object has already been processed by checking its tags
 */
async function hasStateTag(
  s3Client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    const taggingResponse = await s3Client.send(
      new GetObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    return (
      taggingResponse.TagSet?.some((tag) => tag.Key === STATE_TAG_KEY) || false
    );
  } catch (error) {
    console.error(`Error checking tags for ${bucket}/${key}:`, error);
    return false;
  }
}

/**
 * Sets a state tag on an S3 object
 */
async function setStateTag(
  s3Client: S3Client,
  bucket: string,
  key: string,
  state: string,
): Promise<void> {
  try {
    await s3Client.send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        Tagging: {
          TagSet: [
            {
              Key: STATE_TAG_KEY,
              Value: state,
            },
          ],
        },
      }),
    );
    console.log(`✓ Set tag ${STATE_TAG_KEY}=${state} for ${bucket}/${key}`);
  } catch (error) {
    console.error(`Error setting tag for ${bucket}/${key}:`, error);
    throw error;
  }
}

/**
 * Verifies if the file is actually a JPEG by checking its content type and magic bytes
 */
async function getJpegImage(
  response: GetObjectCommandOutput,
): Promise<{ isJpeg: true; buffer: Buffer } | { isJpeg: false }> {
  // Check content type from metadata
  const contentType = response.ContentType;
  if (!contentType || !contentType.toLowerCase().includes("jpeg")) {
    return { isJpeg: false };
  }

  // Check file signature (magic bytes) for JPEG
  // JPEG files start with bytes FF D8 FF
  if (response.Body) {
    try {
      const stream = response.Body as Readable;
      const buffer = await streamToBuffer(stream);

      // JPEG files start with FF D8 FF
      return {
        isJpeg:
          buffer.length >= 3 &&
          buffer[0] === 0xff &&
          buffer[1] === 0xd8 &&
          buffer[2] === 0xff,
        buffer,
      };
    } catch (error) {
      console.error("Error reading image buffer:", error);
      return { isJpeg: false };
    }
  }

  return { isJpeg: false };
}

/**
 * Resizes an image to the specified maximum height, strips identifying metadata,
 * and converts to webp format
 */
async function resizeImage(inputBuffer: Buffer): Promise<Buffer> {
  try {
    // Get image metadata
    const metadata = await sharp(inputBuffer).metadata();

    // Calculate new dimensions maintaining aspect ratio
    const aspectRatio =
      metadata.width && metadata.height ? metadata.width / metadata.height : 1;
    const newHeight = Math.min(metadata.height || MAX_HEIGHT, MAX_HEIGHT);
    const newWidth = Math.round(newHeight * aspectRatio);

    // Resize, strip all identifying metadata (should happen by default), and convert to webp
    return await sharp(inputBuffer)
      .resize(newWidth, newHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(OUTPUT_FORMAT, {
        quality: 85,
      })
      .toBuffer();
  } catch (error) {
    console.error("Error resizing image:", error);
    throw error;
  }
}

/**
 * Checks if a user is authorized to access a group by looking up their admin status in DynamoDB
 */
async function isUserAuthorized(
  ddbClient: DynamoDBClient,
  provider: string,
  userId: string,
  groupId: string,
): Promise<boolean> {
  try {
    const primaryKey = `${userId}#${provider}`;
    const sortKey = `${USER_GROUP_SK}#${groupId}`;

    const params = {
      TableName: Resource.UserTable.name,
      Key: {
        pk: { S: primaryKey },
        sk: { S: sortKey },
      },
    };

    const result = await ddbClient.send(new GetItemCommand(params));

    console.log(result);
    if (result.Item) {
      const item = unmarshall(result.Item);
      console.log(item);
      return item.admin === true;
    }

    return false;
  } catch (error) {
    console.error("Error checking user authorization:", error);
    return false;
  }
}

/**
 * Main handler for SQS messages
 */
export const handler = async (event: SQSEvent) => {
  const batchItemFailures: SQSBatchItemFailure[] = [];
  let count = 0;
  console.log("Num records: " + event.Records.length);

  const s3Client = new S3Client({});
  const ddbClient = new DynamoDBClient({});

  for (const record of event.Records) {
    const messageId = record.messageId;
    try {
      await processMessageAsync(record.body, s3Client, ddbClient);
    } catch (e) {
      console.error(`Failed to process message ${messageId}: ` + e);
      batchItemFailures.push({ itemIdentifier: messageId });
    }
    count++;
  }

  return { batchItemFailures };
};

/**
 * Processes a single SQS message containing S3 event notification
 */
const processMessageAsync = async (
  body: string,
  s3Client: S3Client,
  ddbClient: DynamoDBClient,
) => {
  const parsed = S3NotificationSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    console.error("✗ invalid S3 notification", parsed.error.format());
    // throw to skip bad items
    throw new Error("Validation failed");
  }

  const { Records } = parsed.data;
  // This should always just be a single record
  for (const rec of Records) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    console.log(`✓ processing ${bucket}/${key}`);

    // Step 1: Check if object already has a state tag
    const hasState = await hasStateTag(s3Client, bucket, key);
    if (hasState) {
      console.log(`✓ Object ${bucket}/${key} already processed, skipping`);
      continue;
    }

    try {
      // Get the object
      const getObjectResponse = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      // Step 1.5: Check user authorization
      const metadata = getObjectResponse.Metadata || {};
      const userId = metadata.userid;
      const provider = metadata.provider;
      const group = metadata.group;

      if (!userId || !provider || !group) {
        console.log(
          `✗ Object ${bucket}/${key} missing required metadata (userId, provider, or group): (${userId}, ${provider}, ${group})`,
        );
        await setStateTag(s3Client, bucket, key, STATE_NOT_AUTHORIZED);
        continue;
      }

      // Check if user is authorized for this group
      const authorized = await isUserAuthorized(
        ddbClient,
        provider,
        userId,
        group,
      );
      if (!authorized) {
        console.log(`✗ User ${userId} is not authorized for group ${group}`);
        await setStateTag(s3Client, bucket, key, STATE_NOT_AUTHORIZED);
        continue;
      }
      console.log("✓ User is authorized");

      // Step 2: Verify it's actually a JPEG image
      const jpegImageResult = await getJpegImage(getObjectResponse);
      if (jpegImageResult.isJpeg === false) {
        console.log(`✗ Object ${bucket}/${key} is not a JPEG image`);
        await setStateTag(s3Client, bucket, key, STATE_NOT_IMAGE);
        continue;
      }

      // Step 3: Resize the image and convert to webp
      const resizedBuffer = await resizeImage(jpegImageResult.buffer);

      // Step 4: Upload the resized image to new location
      const outputKey = `${group}_${key}`;

      // Update metadata: keep original metadata but update uploadTime and add fileId
      const originalMetadata = getObjectResponse.Metadata || {};
      const updatedMetadata = {
        ...originalMetadata,
        uploadtime: new Date().toISOString(),
        fileid: key,
      };

      await s3Client.send(
        new PutObjectCommand({
          Bucket: OUTPUT_BUCKET,
          Key: outputKey,
          Body: resizedBuffer,
          ContentType: `image/${OUTPUT_FORMAT}`,
          Metadata: updatedMetadata,
        }),
      );

      // Mark original as processed
      await setStateTag(s3Client, bucket, key, STATE_SUCCESSFUL);

      console.log(
        `✓ Successfully processed ${bucket}/${key} to ${OUTPUT_BUCKET}/${outputKey}`,
      );
    } catch (error) {
      console.error(`Error processing ${bucket}/${key}:`, error);
      await setStateTag(s3Client, bucket, key, STATE_FAILED);
      throw error; // Re-throw to mark as batch failure
    }
  }
};
