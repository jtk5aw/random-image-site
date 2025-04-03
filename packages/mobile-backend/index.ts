import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { bearerAuth } from "hono/bearer-auth";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

// Global auth middleware
const APPLE_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";

// TODO: These will all differ when using expo go vs in the real application. Figure out what they need to be in the real thing
const CLIENT_ID = "host.exp.Exponent";

async function getSigningKey(kid: string) {
  const response = await fetch(APPLE_URL);
  if (!response.ok)
    throw new Error(
      `Could not contact apple endpoint for verifying keys at ${APPLE_URL}`,
    );
  const { keys } = await response.json();
  const key = keys.find((key) => key.kid === kid);
  if (!key) {
    throw new Error("Key not found");
  }

  return crypto.createPublicKey({ key, format: "jwk" });
}

async function validatePayloadValues(payload): Promise<boolean> {
  if (!payload) {
    console.log("No payload provided");
    return false;
  }
  if (payload.iss !== APPLE_ISSUER) {
    console.log(`${payload.iss}  ~= ${APPLE_ISSUER}`);
    return false;
  }
  if (payload.aud !== CLIENT_ID) {
    console.log(`${payload.aud} != ${CLIENT_ID}`);
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    console.log(`${payload.exp} (exp) < ${now} (now)`);
    return false;
  }
  // All validations pass, let it through
  return true;
}

async function verifyAppleToken(token: string) {
  try {
    const decoded = jwt.decode(token, { complete: true });
    const isValidPayload = await validatePayloadValues(decoded?.payload);
    if (!isValidPayload) {
      console.log("failed to validate payload");
      return false;
    }
    const signingKey = await getSigningKey(decoded.header.kid);
    const _result = await jwt.verify(token, signingKey, {
      algorithms: ["RS256"],
    });
  } catch (err) {
    console.log(err);
    return false;
  }
  return true;
}

const AUTH = bearerAuth({
  verifyToken: async (token, c) => {
    return await verifyAppleToken(token);
  },
});

// Create a global middleware for auth header validation
const authHeaderSchema = z.object({
  authorization: z.string().startsWith("Bearer "),
});

const Z_AUTH_HEADER_VALIDATOR = zValidator("header", authHeaderSchema);

// Other schemas as needed
const nameSchema = z.object({
  name: z.string().min(2).optional(),
});

const app = new Hono()
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
    AUTH,
    Z_AUTH_HEADER_VALIDATOR,
    zValidator(
      "header",
      z.object({
        refresh_token: z.string(),
        code: z.string(),
      }),
    ),
    async (c) => {},
  )
  .post(
    "/test/apple",
    AUTH,
    Z_AUTH_HEADER_VALIDATOR,
    zValidator("json", nameSchema),
    async (c) => {
      let json = c.req.valid("json");
      if (json.name) {
        console.log(json.name);
        return c.json({ hello: "world", name: json.name });
      }
      return c.json({ hello: "world", name: null });
    },
  );

export type AppType = typeof app;

export const handler = handle(app);
