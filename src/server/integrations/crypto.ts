import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 * BOB_ENCRYPTION_KEY must be 32 random bytes, base64-encoded:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Tokens are never sent to the browser.
 */
function key(): Buffer {
  const raw = process.env.BOB_ENCRYPTION_KEY;
  if (!raw) throw new Error("BOB_ENCRYPTION_KEY is not set — refusing to store integration tokens.");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("BOB_ENCRYPTION_KEY must be 32 bytes (base64).");
  return k;
}

export function encryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [v, ivB64, tagB64, dataB64] = payload.split(".");
  if (v !== "v1") throw new Error("Unknown token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
