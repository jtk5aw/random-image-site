import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Resource } from "sst";

// TODO TODO TODO: Need to implement a refresh token endpoint
// Then need to set up an endpoint that validates the access token
// Then once that is set up, need to implement auto-refreshing credentials
// when calls are made with bad credentials

// Global auth middleware
const APPLE_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";

// TODO: These will all differ when using expo go vs in the real application. Figure out what they need to be in the real thing
const CLIENT_ID = "com.jtken.randomimagesite";
const MY_ISSUER = "randomimagesite";

// Dynamo constants
const ACCOUNT_SK = "account_sk";
const REFRESH_TOKEN_PREFIX_SK = "refresh_token_sk";

type Result<T> =
  | { success: true; value: T }
  | { success: false; message: string };

type Issuer = "randomimagesite";
type AuthProviders = "apple";

async function getSigningKey(kid: string): Promise<Result<crypto.KeyObject>> {
  const response = await fetch(APPLE_URL);
  if (!response.ok) {
    return {
      success: false,
      message: `Could not contact apple endpoint for verifying keys at ${APPLE_URL}`,
    };
  }
  const { keys } = await response.json();
  const key = keys.find((key) => key.kid === kid);
  if (!key) {
    return { success: false, message: "Key not found" };
  }

  return {
    success: true,
    value: crypto.createPublicKey({ key, format: "jwk" }),
  };
}

async function validatePayloadValues(payload): Promise<Result<undefined>> {
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
    const isValidPayload = await validatePayloadValues(decoded?.payload);
    if (isValidPayload.success == false) {
      console.log(isValidPayload.message);
      return { success: false, message: "Failed to validate payload" };
    }
    const signingKey = await getSigningKey(decoded.header.kid);
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

type TokenPayload = {
  iss: Issuer;
  sub: string;
  orig: AuthProviders;
  iat: number;
  exp: number;
  type: "access";
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
    });
    const refreshToken = jwt.sign(
      tokenPayload,
      Resource.RefreshTokenSecret.value,
      { expiresIn: "7d" },
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
    const tokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    // Create token info object with hash and timestamp
    const newTokenInfo = {
      hash: tokenHash,
      createdAt: now,
      used: false,
    };

    // Try to get the existing record with the list of tokens
    const getParams = {
      TableName: Resource.UserTable.name,
      Key: {
        pk: { S: primaryKey },
        sk: { S: REFRESH_TOKEN_PREFIX_SK },
      },
    };

    const getCommand = new GetItemCommand(getParams);
    const getResult = await ddb.send(getCommand);

    let tokenList = [];

    // If record exists, get the existing token list
    if (getResult.Item) {
      const item = unmarshall(getResult.Item);
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
    const putParams = {
      TableName: Resource.UserTable.name,
      Item: {
        pk: { S: primaryKey },
        sk: { S: REFRESH_TOKEN_PREFIX_SK },
        tokenList: {
          L: tokenList.map((token) => ({
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
    console.log(
      `Successfully saved refresh token list with ${tokenList.length} tokens`,
    );

    return { success: true, value: undefined };
  } catch (error) {
    console.error("Error saving refresh token:", error);
    return { success: false, message: "Failed to save refresh tokens list" };
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
      email: { S: email },
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

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});

type MyEnv = {
  Variables: {
    ddb: DynamoDBClient;
  };
};

const app = new Hono<MyEnv>()
  .use(async (c, next) => {
    c.set("ddb", dynamoClient);
    await next();
  })
  // Add a custom onError handler for the entire app
  .onError((err, c) => {
    console.log(err);
    const status = err.status || 500;

    // Check if it's an auth error based on status code
    if (status === 401) {
      return c.json({ error: "Authentication failed", status: 401 }, 401);
    }

    // Handle validation errors from zValidator
    if (err instanceof z.ZodError) {
      const errorDetails = err.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      }));
      return c.json(
        {
          error: "Validation error",
          details: errorDetails,
          status: 400,
        },
        400,
      );
    }

    // Handle other errors
    return c.json({ error: "Internal server error", status: 500 }, 500);
  })
  .post(
    "/login",
    zValidator(
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
        return c.json({ success: false, message: "Failed to authenticate" });
      }

      if (!verifyTokenResult.value?.payload?.sub) {
        console.log("No payload or sub was provided");
        console.log(verifyTokenResult.value);
        return c.json({ success: false, message: "Failed to authenticate" });
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
        return c.json({ success: false, message: "Failed to authenticate" });
      }

      const createTokensResult = await createTokens(userId, "apple");
      if (createTokensResult.success == false) {
        console.log(createTokensResult.message);
        return c.json({ success: false, message: "Failed to authenticate" });
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

      return c.json({
        success: true,
        accessToken: createTokensResult.value.accessToken,
        refreshToken: createTokensResult.value.refreshToken,
      });
    },
  );

export type AppType = typeof app;
export const handler = handle(app);
