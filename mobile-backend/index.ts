import * as jwt from "jsonwebtoken";
import * as crypto from "crypto";
import { bearerAuth } from "hono/bearer-auth";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

const APPLE_URL = "https://appleid.apple.com/auth/keys";

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

async function verifyAppleToken(token: string) {
  const decoded = jwt.decode(token, { complete: true });
  const signingKey = await getSigningKey(decoded.header.kid);
  return await jwt.verify(token, signingKey, { algorithms: ["RS256"] });
}

const app = new Hono().get(
  "/apple",
  bearerAuth({
    verifyToken: async (token, c) => {
      return await verifyAppleToken(token);
    },
  }),
  async (c) => {
    return c.json({ hello: "world" });
  },
);

export const handler = handle(app);
