import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { Hono, ValidationTargets } from "hono";
import { handle } from "hono/aws-lambda";
import { zValidator } from "@hono/zod-validator";
import { z, ZodSchema } from "zod";
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Resource } from "sst";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { bearerAuth } from "hono/bearer-auth";
import { createMiddleware } from "hono/factory";

// Customized zodValidator
class ValidationError extends Error {
  private details: any;
  constructor(details: any) {
    super(details);
    this.details = details;

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  getDetails() {
    return this.details;
  }
}

export const zv = <T extends ZodSchema, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result, c) => {
    if (result.success == false) {
      const errorDetails = result.error.errors.map((e) => ({
        path: JSON.stringify(e.path.join(".")),
        message: e.message,
      }));
      throw new ValidationError(errorDetails);
    }
  });

// Global auth middleware
const APPLE_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";

// TODO: These will all differ when using expo go vs in the real application. Figure out what they need to be in the real thing
const CLIENT_ID = "com.jtken.randomimagesite";
const MY_ISSUER = "randomimagesite";

// Dynamo constants
const ACCOUNT_SK = "account_sk";
const REFRESH_TOKEN_PREFIX_SK = "refresh_token_sk";
const UPLOAD_RATE_LIMIT_SK = "upload_rate_limit_sk";

type Result<T> =
  | { success: true; value: T }
  | { success: false; message: string };

function unsuccessful<T>(message: string): Result<T> {
  return { success: false, message };
}

function successful<T>(value: T): Result<T> {
  return { success: true, value };
}

type Issuer = "randomimagesite";
type AuthProviders = "apple";

/// Functions for verifying Apple Tokens ///
// TODO: See if this can be abstracted for verifying my tokens as well
async function getAppleSigningKey(
  kid: string,
): Promise<Result<crypto.KeyObject>> {
  const response = await fetch(APPLE_URL);
  if (!response.ok) {
    return {
      success: false,
      message: `Could not contact apple endpoint for verifying keys at ${APPLE_URL}`,
    };
  }
  const { keys } = await response.json();
  const key = keys.find((key: any) => key.kid === kid);
  if (!key) {
    return { success: false, message: "Key not found" };
  }

  return {
    success: true,
    value: crypto.createPublicKey({ key, format: "jwk" }),
  };
}

async function validateApplePayloadValues(
  payload: any,
): Promise<Result<undefined>> {
  if (!payload) {
    return { success: false, message: "No payload provided" };
  }
  if (payload.iss !== APPLE_ISSUER) {
    return { success: false, message: `${payload.iss}  ~= ${APPLE_ISSUER}` };
  }
  if (payload.aud !== CLIENT_ID) {
    return { success: false, message: `${payload.aud} != ${CLIENT_ID}` };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return { success: false, message: `${payload.exp} (exp) < ${now} (now)` };
  }
  // All validations pass, let it through
  return { success: true, value: undefined };
}

async function verifyAppleToken(token: string): Promise<Result<any>> {
  try {
    const decoded = jwt.decode(token, { complete: true });
    const isValidPayload = await validateApplePayloadValues(decoded?.payload);
    if (isValidPayload.success == false) {
      console.log(isValidPayload.message);
      return { success: false, message: "Failed to validate payload" };
    }
    const signingKey = await getAppleSigningKey(decoded.header.kid);
    if (signingKey.success == false) {
      console.log(signingKey.message);
      return { success: false, message: "Failed to get signing key" };
    }
    await jwt.verify(token, signingKey.value, {
      algorithms: ["RS256"],
    });
    return { success: true, value: decoded };
  } catch (err) {
    console.log(err);
    return { success: false, message: "Error thrown during verification" };
  }
}

/// Methods for veryfing my token values ///

// NOTE: This doesn't use an aud value because that is basiclaly filled by issuer here.
// My server is issuing and receiving the token so it serves no value for the time being
async function validateMyPayloadValues(
  payload: TokenPayload,
  expectedType: string,
): Promise<Result<undefined>> {
  if (!payload) {
    return { success: false, message: "No payload provided" };
  }
  if (payload.iss !== MY_ISSUER) {
    return { success: false, message: `${payload.iss}  ~= ${MY_ISSUER}` };
  }
  // No aud value for now
  if (payload.orig != "apple") {
    return { success: false, message: `${payload.orig} ~= "apple"` };
  }
  if (payload.type != expectedType) {
    return {
      success: false,
      message: `Didn't provide an ${expectedType} token`,
    };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return { success: false, message: `${payload.exp} (exp) < ${now} (now)` };
  }
  // All validations pass, let it through
  return { success: true, value: undefined };
}

async function verifyMyToken(
  token: string,
  key: string,
  type: string,
): Promise<Result<any>> {
  try {
    const decoded = jwt.decode(token, { complete: true });
    const isValidPayload = await validateMyPayloadValues(
      decoded?.payload,
      type,
    );
    if (isValidPayload.success == false) {
      console.log(isValidPayload.message);
      return { success: false, message: "Failed to validate payload" };
    }
    await jwt.verify(token, key, {
      algorithms: ["HS256"],
    });
    return { success: true, value: decoded };
  } catch (err) {
    console.log(err);
    return { success: false, message: "Error thrown during verification" };
  }
}

// Auth middleware code

const MY_AUTHENTICATION = createMiddleware<{
  Variables: { decodedToken: string; decodedTokenPayload: TokenPayload };
}>(
  bearerAuth({
    verifyToken: async (token, c) => {
      const result = await verifyMyToken(
        token,
        // TODO: Consider tieing the token type with the secret value so that it isn't hardcoded here
        Resource.AuthTokenSecret.value,
        "access",
      );
      if (result.success == false) {
        console.log(result.message);
        return false;
      }
      c.set("decodedToken", result.value);
      c.set("decodedTokenPayload", result.value.payload);
      return true;
    },
  }),
);

const MY_AUTHENTICATION_VALIDATOR = zv(
  "header",
  z.object({
    // TODO: The "Bearer " bit might not be necessary cause the built in auth validator
    // fails before then anyways
    Authorization: z.string().startsWith("Bearer "),
  }),
);

// Creating tokens code

type TokenPayload = {
  iss: Issuer;
  sub: string;
  orig: AuthProviders;
  iat: number;
  exp: number;
  type: "access" | "refresh";
};

type PreSignaturePayload = Omit<TokenPayload, "exp">;

async function createTokens(
  userId: string,
  authProvider: AuthProviders,
): Promise<Result<{ accessToken: string; refreshToken: string }>> {
  try {
    const now = Math.floor(new Date().getTime() / 1000);
    const tokenPayload: PreSignaturePayload = {
      iss: MY_ISSUER,
      sub: userId,
      orig: authProvider,
      iat: now,
      type: "access",
    };
    const accessToken = jwt.sign(tokenPayload, Resource.AuthTokenSecret.value, {
      expiresIn: "15m",
      algorithm: "HS256",
    });
    const refreshTokenPayload: PreSignaturePayload = {
      iss: MY_ISSUER,
      sub: userId,
      orig: authProvider,
      iat: now,
      type: "refresh",
    };
    const refreshToken = jwt.sign(
      refreshTokenPayload,
      Resource.RefreshTokenSecret.value,
      { expiresIn: "7d", algorithm: "HS256" },
    );
    return { success: true, value: { accessToken, refreshToken } };
  } catch (e) {
    console.log("Failed while signing a token");
    console.log(e);
    return {
      success: false,
      message: "Failed to sign either access or refresh token",
    };
  }
}

function hashRefreshToken(refreshToken: string): string {
  return crypto.createHash("sha256").update(refreshToken).digest("hex");
}

// TODO: Use Zod to validate the data fetched from DDB
async function getRefreshTokens(
  ddb: DynamoDBClient,
  primaryKey: string,
): Promise<Result<any>> {
  try {
    // Try to get the existing record with the list of tokens
    const getParams = {
      TableName: Resource.UserTable.name,
      Key: {
        pk: { S: primaryKey },
        sk: { S: REFRESH_TOKEN_PREFIX_SK },
      },
    };

    const getCommand = new GetItemCommand(getParams);
    const ddbResult = await ddb.send(getCommand);
    if (ddbResult.Item) {
      return successful(unmarshall(ddbResult.Item));
    }
    return successful(undefined);
  } catch (e) {
    console.log(e);
    return unsuccessful("Failed to successfully query DDB");
  }
}

interface Token {
  hash: string;
  createdAt: number;
  used: boolean;
}

async function updateRefreshTokens(
  ddb: DynamoDBClient,
  primaryKey: string,
  now: number,
  tokenList: Token[],
): Promise<Result<undefined>> {
  try {
    const putParams = {
      TableName: Resource.UserTable.name,
      Item: {
        pk: { S: primaryKey },
        sk: { S: REFRESH_TOKEN_PREFIX_SK },
        tokenList: {
          L: tokenList.map((token: any) => ({
            M: {
              hash: { S: token.hash },
              createdAt: { N: token.createdAt.toString() },
              used: { BOOL: !!token.used },
            },
          })),
        },
        updatedAt: { N: now.toString() },
      },
    };

    await ddb.send(new PutItemCommand(putParams));

    return successful(undefined);
  } catch (e) {
    console.log(e);
    return unsuccessful("Failed to update refresh tokens");
  }
}

async function saveRefreshToken(
  ddb: DynamoDBClient,
  userId: string,
  provider: AuthProviders,
  refreshToken: string,
): Promise<Result<undefined>> {
  try {
    const now = Math.floor(new Date().getTime() / 1000);
    const primaryKey = `${userId}#${provider}`;

    // Hash the token before storing it
    const tokenHash = hashRefreshToken(refreshToken);

    // Create token info object with hash and timestamp
    const newTokenInfo: Token = {
      hash: tokenHash,
      createdAt: now,
      used: false,
    };

    let tokenList: Token[] = [];

    const getResult = await getRefreshTokens(ddb, primaryKey);
    if (getResult.success == false) {
      console.log(getResult.message);
      return unsuccessful("Failed to call DDB to get refreshTokens");
    }

    // If record exists, get the existing token list
    if (getResult.value) {
      const item = getResult.value;
      console.log("Found existing token record:", item);

      if (item.tokenList && Array.isArray(item.tokenList)) {
        tokenList = item.tokenList;
        console.log(
          `Found existing token list with ${tokenList.length} tokens`,
        );
      }
    } else {
      console.log("No existing token record found, creating new one");
    }

    // Add the new token to the beginning of the list (newest first)
    tokenList.unshift(newTokenInfo);

    // Keep only the 5 most recent tokens
    if (tokenList.length > 5) {
      tokenList = tokenList.slice(0, 5);
    }

    console.log(`Saving updated token list with ${tokenList.length} tokens`);

    // Write the updated token list to DynamoDB
    const putResult = await updateRefreshTokens(
      ddb,
      primaryKey,
      now,
      tokenList,
    );
    if (putResult.success == false) {
      console.log(putResult.message);
      unsuccessful("Failed to update refresh tokens");
    }

    console.log(
      `Successfully saved refresh token list with ${tokenList.length} tokens`,
    );
    return successful(undefined);
  } catch (error) {
    console.error("Error saving refresh token:", error);
    return unsuccessful("Failed to save refresh tokens list");
  }
}

async function refreshToken(
  ddb: DynamoDBClient,
  userId: string,
  authProvider: AuthProviders,
  toValidateRefreshToken: string,
  newRefreshToken: string,
): Promise<Result<undefined>> {
  try {
    const primaryKey = `${userId}#${authProvider}`;
    const getResult = await getRefreshTokens(ddb, primaryKey);
    if (getResult.success == false) {
      console.log(getResult.message);
      return unsuccessful("Unable to retrieve refresh tokens");
    }
    let tokenList = getResult.value?.tokenList;
    if (!tokenList || tokenList.length == 0) {
      console.log("Zero refresh tokens found");
      return unsuccessful("No refresh tokens exist");
    }

    const toValidateRefreshTokenHash = hashRefreshToken(toValidateRefreshToken);
    let mostRecentEntry = tokenList[0];
    if (
      mostRecentEntry.used ||
      mostRecentEntry.hash != toValidateRefreshTokenHash
    ) {
      console.log(
        `Used: ${mostRecentEntry.used}, mostRecent != current, ${mostRecentEntry.hash != toValidateRefreshTokenHash}`,
      );
      return unsuccessful("Couldn't match the hash");
    }

    // Update the entry and then return success cause we matched the hash
    // Update the entry in two ways
    // 1. set the most recent entry as used
    // 2. Create a new most recent entry with the next refresh token
    mostRecentEntry.used = true;
    const now = Math.floor(new Date().getTime() / 1000);
    const newTokenInfo: Token = {
      hash: hashRefreshToken(newRefreshToken),
      createdAt: now,
      used: false,
    };
    tokenList.unshift(newTokenInfo);
    if (tokenList.length > 5) {
      tokenList = tokenList.slice(0, 5);
    }

    const updateResult = await updateRefreshTokens(
      ddb,
      primaryKey,
      now,
      tokenList,
    );
    if (updateResult.success == false) {
      console.log(updateResult.message);
      return unsuccessful("Failed to update tokens after matching");
    }
    return successful(undefined);
  } catch (e) {
    console.log(e);
    return unsuccessful("Failed attempt to refresh tokens");
  }
}

async function createUser(
  ddb: DynamoDBClient,
  userId: string,
  email: string | undefined,
  provider: AuthProviders,
): Promise<Result<{ isNewUser: boolean }>> {
  const now = new Date().getTime();
  const primaryKey = `${userId}#${provider}`;

  const params = {
    TableName: Resource.UserTable.name,
    Item: {
      pk: { S: primaryKey },
      sk: { S: ACCOUNT_SK },
      email: { S: email || "" },
      createdAt: { N: now.toString() },
    },
    ConditionExpression: "attribute_not_exists(pk)",
  };

  try {
    await ddb.send(new PutItemCommand(params));
    return { success: true, value: { isNewUser: true } };
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) {
      // This is fine and should result in a success
      return { success: true, value: { isNewUser: false } };
    }
    // Actual error occurred return a failure
    console.log(e);
    return { success: false, message: "Failed to make request to dynamo" };
  }
}

/**
 * Gets the current hour in epoch seconds, rounded down to the hour
 * Example: 1746299008 -> 1746298800 (seconds at the start of the hour)
 *
 * @returns Epoch timestamp rounded down to the nearest hour
 */
function getCurrentHourKey(): number {
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  const SECONDS_IN_HOUR = 3600;
  return now - (now % SECONDS_IN_HOUR); // Round down to the nearest hour
}

/**
 * Checks and updates the rate limit for user uploads using conditional update
 * Allows 10 uploads per hour per user
 *
 * @param ddb DynamoDB client
 * @param userId User ID
 * @param provider Auth provider
 * @returns Result indicating if the rate limit has been exceeded and remaining uploads
 */
async function checkAndUpdateUploadRateLimit(
  ddb: DynamoDBClient,
  userId: string,
  provider: AuthProviders,
): Promise<Result<{ canUpload: boolean; remainingUploads: number }>> {
  try {
    const primaryKey = `${userId}#${provider}`;
    const hourKey = getCurrentHourKey();
    const sortKey = `${UPLOAD_RATE_LIMIT_SK}#${hourKey}`;
    const HOURLY_LIMIT = 10;

    // Use UpdateItem with a conditional expression to atomically increment the counter
    // if it's less than the limit
    const updateParams = {
      TableName: Resource.UserTable.name,
      Key: {
        pk: { S: primaryKey },
        sk: { S: sortKey },
      },
      UpdateExpression:
        "SET uploadCount = if_not_exists(uploadCount, :zero) + :inc, updatedAt = :now",
      ConditionExpression:
        "attribute_not_exists(uploadCount) OR uploadCount < :limit",
      ExpressionAttributeValues: {
        ":zero": { N: "0" },
        ":inc": { N: "1" },
        ":limit": { N: HOURLY_LIMIT.toString() },
        ":now": { N: Math.floor(Date.now() / 1000).toString() },
      },
      ReturnValues: "UPDATED_NEW",
    };

    try {
      const result = await ddb.send(new UpdateItemCommand(updateParams));
      const newCount = parseInt(result.Attributes?.uploadCount.N || "1");

      return successful({
        canUpload: true,
        remainingUploads: HOURLY_LIMIT - newCount,
      });
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) {
        // Condition failed means we've hit the rate limit
        return successful({
          canUpload: false,
          remainingUploads: 0,
        });
      }
      return unsuccessful("Failed to update rate limit");
    }
  } catch (e) {
    console.error("Error checking upload rate limit:", e);
    return unsuccessful("Failed to check upload rate limit");
  }
}

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const s3Client = new S3Client({});

type MyEnv = {
  Variables: {
    ddb: DynamoDBClient;
    s3: S3Client;
    decodedToken: string;
  };
};

const app = new Hono<MyEnv>()
  .use(async (c, next) => {
    c.set("ddb", dynamoClient);
    c.set("s3", s3Client);
    await next();
  })
  // Authentication for /api routes
  // Note: I'd like to only put MY_AUTHENTICATION_VALIDATOR once but then the RPC client doesn't pick up the header as necessary
  .use("/api/*", MY_AUTHENTICATION)
  // Add a custom onError handler for the entire app
  .onError((err, c) => {
    const status = err.status || 500;

    // Check if it's an auth error based on status code
    if (status === 401) {
      return c.json({ error: "Authentication failed", status: 401 }, 401);
    }

    if (err instanceof ValidationError) {
      return c.json(
        { error: "Validation failed", details: err.getDetails(), status: 400 },
        400,
      );
    }

    if (status < 500) {
      return c.json(
        { error: "Exception occurred", message: err.message, status },
        status,
      );
    }

    // Handle other errors as internal failures
    console.log("Internal Failure occurred loggging the error ...");
    console.log(err);
    return c.json({ error: "Internal server error", status: 500 }, 500);
  })
  .post(
    "/login",
    zv(
      "header",
      z.object({
        apple_token: z.string(),
      }),
    ),
    async (c) => {
      const headers = c.req.valid("header");

      const verifyTokenResult = await verifyAppleToken(headers.apple_token);
      if (verifyTokenResult.success == false) {
        console.log(verifyTokenResult.message);
        return c.json(unsuccessful("Failed to authenticate"), 401);
      }

      if (!verifyTokenResult.value?.payload?.sub) {
        console.log("No payload or sub was provided");
        console.log(verifyTokenResult.value);
        return c.json(unsuccessful("Failed to authenticate"), 401);
      }

      const payload = verifyTokenResult.value.payload;
      const userId = payload.sub;

      const createUserResult = await createUser(
        c.get("ddb"),
        userId,
        payload.email,
        "apple",
      );
      if (createUserResult.success == false) {
        console.log(createUserResult.message);
        return c.json(unsuccessful("Failed to authenticate"), 401);
      }

      const createTokensResult = await createTokens(userId, "apple");
      if (createTokensResult.success == false) {
        console.log(createTokensResult.message);
        return c.json(unsuccessful("Failed to authenticate"), 401);
      }

      const saveRefreshTokenResult = await saveRefreshToken(
        c.get("ddb"),
        userId,
        "apple",
        createTokensResult.value.refreshToken,
      );
      if (saveRefreshTokenResult.success == false) {
        console.log(saveRefreshTokenResult.message);
        console.log(
          "Failed to save refresh tokens, this won't block this login though",
        );
      }

      return c.json(
        successful({
          accessToken: createTokensResult.value.accessToken,
          refreshToken: createTokensResult.value.refreshToken,
        }),
      );
    },
  )
  .post(
    "/refresh",
    zv(
      "header",
      z.object({
        refresh_token: z.string(),
      }),
    ),
    async (c) => {
      const headers = c.req.valid("header");
      const verifyTokenResult = await verifyMyToken(
        headers.refresh_token,
        Resource.RefreshTokenSecret.value,
        "refresh",
      );
      if (verifyTokenResult.success == false) {
        console.log(verifyTokenResult.message);
        return c.json(unsuccessful("Failed to refresh token"));
      }
      const payload: TokenPayload = verifyTokenResult.value.payload;

      // Create them first to save an update to DDB
      // Is that bad?
      const createTokensResult = await createTokens(payload.sub, "apple");
      if (createTokensResult.success == false) {
        console.log(createTokensResult.message);
        return c.json(unsuccessful("Failed to refresh"), 401);
      }

      const validateRefreshTokenResult = await refreshToken(
        c.get("ddb"),
        payload.sub,
        payload.orig,
        headers.refresh_token,
        createTokensResult.value.refreshToken,
      );
      if (validateRefreshTokenResult.success == false) {
        console.log(validateRefreshTokenResult.message);
        return c.json(unsuccessful("Failed to refresh"), 401);
      }
      return c.json(
        successful({
          accessToken: createTokensResult.value.accessToken,
          refreshToken: createTokensResult.value.refreshToken,
        }),
      );
    },
  )
  .post("/api/test", MY_AUTHENTICATION_VALIDATOR, async (c) => {
    const test = c.get("decodedToken");
    console.log(test);
    const payload = c.get("decodedTokenPayload");
    console.log(payload);
    return c.json({ message: "This is a temporary endpoint" });
  })
  .get(
    "/api/upload/:group",
    MY_AUTHENTICATION_VALIDATOR,
    zv(
      "param",
      z.object({
        group: z.string().min(1).max(100),
      }),
    ),
    async (c) => {
      const s3 = c.get("s3");
      const ddb = c.get("ddb");
      const payload = c.get("decodedTokenPayload");
      const userId = payload.sub;
      const provider = payload.orig;
      const params = c.req.valid("param");

      try {
        // Check and update rate limit using the hourly counter approach
        const rateLimitResult = await checkAndUpdateUploadRateLimit(
          ddb,
          userId,
          provider,
        );

        if (rateLimitResult.success === false) {
          console.log(`Rate limit check failed: ${rateLimitResult.message}`);
          return c.json(unsuccessful("Failed to upload"), 500);
        }

        // If user has exceeded their upload limit
        if (!rateLimitResult.value.canUpload) {
          return c.json(
            unsuccessful(
              "Upload rate limit exceeded. You can upload a maximum of 10 images per hour.",
            ),
            429, // Too Many Requests
          );
        }

        // Generate a unique file name using UUID
        const fileId = uuidv4();
        const key = fileId;

        // Create the command for putting an object in S3
        const putObjectCommand = new PutObjectCommand({
          Bucket: Resource.InitialUploadBucket.name,
          Key: key,
          Metadata: {
            userId: userId,
            group: params.group,
            provider: provider,
            uploadTime: new Date().toISOString(),
          },
        });

        // Generate a presigned URL that will be valid for 1 minute
        const presignedUrl = await getSignedUrl(s3, putObjectCommand, {
          expiresIn: 60, // 1 minute
        });

        return c.json(
          successful({
            presignedUrl,
            remainingUploads: rateLimitResult.value.remainingUploads,
          }),
        );
      } catch (e) {
        console.log("Failed to generate presigned URL: " + e);
        return c.json(unsuccessful("Failed to generate upload URL"), 500);
      }
    },
  );

export type AppType = typeof app;
export const handler = handle(app);
