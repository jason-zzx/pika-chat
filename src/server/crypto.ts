import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KDF_SALT = "pika-chat/credential-cipher/v1";
const VERSION = "v1";

let cachedKey: Buffer | undefined;

function credentialKey(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(getEnv().CREDENTIAL_ENCRYPTION_SECRET, KDF_SALT, 32);
  }
  return cachedKey;
}

function decryptFailed(): never {
  throw new AppError("INTERNAL", 500, "crypto.decryptFailed");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, credentialKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4) {
    decryptFailed();
  }
  const version = parts[0];
  const ivPart = parts[1];
  const ciphertextPart = parts[2];
  const authTagPart = parts[3];
  if (version !== VERSION || !ivPart || !ciphertextPart || !authTagPart) {
    decryptFailed();
  }

  try {
    const iv = Buffer.from(ivPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    const authTag = Buffer.from(authTagPart, "base64url");
    const decipher = createDecipheriv(ALGORITHM, credentialKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    decryptFailed();
  }
}
