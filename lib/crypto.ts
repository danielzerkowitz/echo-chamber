import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Provider API keys are encrypted at rest with AES-256-GCM under
// APP_ENCRYPTION_KEY (32 random bytes, base64). Stored as v1.<iv>.<ct>.<tag>.

function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), ct.toString("base64"), tag.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, ivB64, ctB64, tagB64] = stored.split(".");
  if (version !== "v1" || !ivB64 || !ctB64 || !tagB64) {
    throw new Error("unrecognized ciphertext format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
