import "server-only";

import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as postQrCode } from "@/app/api/account/2fa/qrcode/route";
import {
  adminCredentials,
  authGet,
  authPost,
  cookiesFrom,
  jsonRequest,
  postSetup,
  readJson,
} from "@/server/auth/auth-test-helpers";
import { getDb } from "@/server/db/client";
import {
  accounts,
  sessions,
  twoFactors,
  users,
  verifications,
} from "@/server/db/schema";

const db = getDb();

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const WELL_FORMED_URI =
  "otpauth://totp/Pika%20chat:member@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Pika%20chat";

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new Error("expected an object");
}

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * RFC 6238 TOTP over HMAC-SHA1, matching better-auth's defaults (6 digits,
 * 30-second period). Computed here rather than imported so the test does not
 * depend on better-auth's transitive packages.
 */
function totpCode(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counterBytes)
    .digest();
  const lastByte = digest.at(-1);
  if (lastByte === undefined) {
    throw new Error("unexpected empty digest");
  }
  const truncated = digest.readUInt32BE(lastByte & 0x0f) & 0x7fffffff;
  return (truncated % 1_000_000).toString().padStart(6, "0");
}

function secretFromUri(uri: unknown): string {
  if (typeof uri !== "string") {
    throw new Error("expected a totp URI");
  }
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) {
    throw new Error("totp URI carried no secret");
  }
  return secret;
}

function readCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("expected a list of backup codes");
  }
  const codes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error("expected every backup code to be a string");
    }
    codes.push(entry);
  }
  return codes;
}

function firstCode(codes: string[]): string {
  const code = codes[0];
  if (code === undefined) {
    throw new Error("expected at least one backup code");
  }
  return code;
}

async function resetTwoFactorState(): Promise<void> {
  await db.delete(twoFactors);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(verifications);
  await db.delete(users);
}

async function setupAdmin(): Promise<string> {
  const response = await postSetup(
    jsonRequest("/api/setup", { body: adminCredentials }),
  );
  expect(response.status).toBe(201);
  return cookiesFrom(response);
}

async function storedTwoFactorState(): Promise<{
  verified: boolean | undefined;
  enabled: boolean | undefined;
}> {
  const rows = await db
    .select({ verified: twoFactors.verified })
    .from(twoFactors);
  const userRows = await db
    .select({ twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.email, adminCredentials.email));
  return {
    verified: rows[0]?.verified,
    enabled: userRows[0]?.twoFactorEnabled,
  };
}

async function signIn(): Promise<Response> {
  return authPost(
    jsonRequest("/api/auth/sign-in/username", {
      body: {
        username: adminCredentials.username,
        password: adminCredentials.password,
      },
    }),
  );
}

async function enableTwoFactor(cookie: string): Promise<{
  payload: Record<string, unknown>;
  totpURI: unknown;
  backupCodes: string[];
}> {
  const response = await authPost(
    jsonRequest("/api/auth/two-factor/enable", {
      cookie,
      body: { password: adminCredentials.password },
    }),
  );
  expect(response.status).toBe(200);
  const payload = asObject(await readJson(response));
  return {
    payload,
    totpURI: payload.totpURI,
    backupCodes: readCodes(payload.backupCodes),
  };
}

async function confirmTwoFactor(cookie: string, secret: string): Promise<Response> {
  return authPost(
    jsonRequest("/api/auth/two-factor/verify-totp", {
      cookie,
      body: { code: totpCode(secret) },
    }),
  );
}

/** Enrolls and confirms, returning the confirmed session plus both secrets. */
async function enroll(): Promise<{ cookie: string; secret: string; backupCodes: string[] }> {
  const cookie = await setupAdmin();
  const enrollment = await enableTwoFactor(cookie);
  const secret = secretFromUri(enrollment.totpURI);
  const confirm = await confirmTwoFactor(cookie, secret);
  expect(confirm.status).toBe(200);
  return {
    cookie: cookiesFrom(confirm),
    secret,
    backupCodes: enrollment.backupCodes,
  };
}

describe("two-factor", () => {
  beforeEach(async () => {
    await resetTwoFactorState();
  });

  afterAll(async () => {
    await resetTwoFactorState();
  });

  it("stores an unverified secret and leaves the account single-step until confirmed", async () => {
    const cookie = await setupAdmin();
    const enrollment = await enableTwoFactor(cookie);

    // The URI and the codes are the caller's own enrollment material; the
    // stored secret column is never echoed back.
    expect(String(enrollment.totpURI)).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.backupCodes).toHaveLength(10);
    expect(enrollment.payload.secret).toBeUndefined();

    const state = await storedTwoFactorState();
    expect(state.verified).toBe(false);
    expect(state.enabled).toBe(false);

    // Half-finished setup must not push the user into a challenge (AC10).
    const signInResponse = await signIn();
    expect(signInResponse.status).toBe(200);
    const signInBody = asObject(await readJson(signInResponse));
    expect(signInBody.twoFactorRedirect).toBeUndefined();
  });

  it("turns 2FA on only after a valid code, and then demands a second step", async () => {
    const cookie = await setupAdmin();
    const enrollment = await enableTwoFactor(cookie);
    const secret = secretFromUri(enrollment.totpURI);

    const rejected = await authPost(
      jsonRequest("/api/auth/two-factor/verify-totp", {
        cookie,
        body: { code: "000000" },
      }),
    );
    expect(rejected.status).toBe(401);

    const confirm = await confirmTwoFactor(cookie, secret);
    expect(confirm.status).toBe(200);

    const state = await storedTwoFactorState();
    expect(state.verified).toBe(true);
    expect(state.enabled).toBe(true);

    const signInResponse = await signIn();
    const signInBody = asObject(await readJson(signInResponse));
    expect(signInBody.twoFactorRedirect).toBe(true);
    expect(signInBody.twoFactorMethods).toEqual(["totp"]);

    // Step one must not hand out an authenticated session.
    const challengeCookie = cookiesFrom(signInResponse);
    const session = await authGet(
      jsonRequest("/api/auth/get-session", { cookie: challengeCookie }),
    );
    expect(await readJson(session)).toBeNull();
  });

  it("completes the challenge with a TOTP code and never leaks the stored secret", async () => {
    const enrollment = await enroll();

    const signInResponse = await signIn();
    const challengeCookie = cookiesFrom(signInResponse);
    const verified = await authPost(
      jsonRequest("/api/auth/two-factor/verify-totp", {
        cookie: challengeCookie,
        body: { code: totpCode(enrollment.secret) },
      }),
    );
    expect(verified.status).toBe(200);

    const sessionCookie = cookiesFrom(verified);
    const session = await authGet(
      jsonRequest("/api/auth/get-session", { cookie: sessionCookie }),
    );
    const sessionBody = asObject(await readJson(session));
    // The flag the settings page reads on reload (AC6).
    expect(asObject(sessionBody.user).twoFactorEnabled).toBe(true);
    const serialized = JSON.stringify(sessionBody);
    expect(serialized).not.toContain(enrollment.secret);
    expect(serialized).not.toContain("backupCodes");
    expect(serialized).toContain(adminCredentials.username);
  });

  it("accepts a backup code issued at enrollment", async () => {
    const enrollment = await enroll();

    const challenge = cookiesFrom(await signIn());
    const accepted = await authPost(
      jsonRequest("/api/auth/two-factor/verify-backup-code", {
        cookie: challenge,
        body: { code: firstCode(enrollment.backupCodes) },
      }),
    );
    expect(accepted.status).toBe(200);
  });

  it("invalidates the previous backup-code set on regeneration", async () => {
    const enrollment = await enroll();

    const regenerated = await authPost(
      jsonRequest("/api/auth/two-factor/generate-backup-codes", {
        cookie: enrollment.cookie,
        body: { password: adminCredentials.password },
      }),
    );
    expect(regenerated.status).toBe(200);
    const freshCodes = readCodes(
      asObject(await readJson(regenerated)).backupCodes,
    );

    const firstChallenge = cookiesFrom(await signIn());
    const stale = await authPost(
      jsonRequest("/api/auth/two-factor/verify-backup-code", {
        cookie: firstChallenge,
        body: { code: firstCode(enrollment.backupCodes) },
      }),
    );
    expect(stale.status).toBe(401);

    const secondChallenge = cookiesFrom(await signIn());
    const accepted = await authPost(
      jsonRequest("/api/auth/two-factor/verify-backup-code", {
        cookie: secondChallenge,
        body: { code: firstCode(freshCodes) },
      }),
    );
    expect(accepted.status).toBe(200);
  });

  it("signs the other sessions out on enable and keeps the confirming one", async () => {
    const adminCookie = await setupAdmin();
    // A second live session, created before 2FA existed. It would otherwise
    // keep working without the second factor.
    const otherSession = cookiesFrom(await signIn());

    const enrollment = await enableTwoFactor(adminCookie);
    const secret = secretFromUri(enrollment.totpURI);
    const confirm = await confirmTwoFactor(adminCookie, secret);
    expect(confirm.status).toBe(200);
    const currentSession = cookiesFrom(confirm);

    const before = await authGet(
      jsonRequest("/api/auth/get-session", { cookie: otherSession }),
    );
    expect(await readJson(before)).not.toBeNull();

    // The exact call TwoFactorCard makes right after a successful confirmation.
    const revoked = await authPost(
      jsonRequest("/api/auth/revoke-other-sessions", {
        method: "POST",
        cookie: currentSession,
      }),
    );
    expect(revoked.status).toBe(200);

    const surviving = await authGet(
      jsonRequest("/api/auth/get-session", { cookie: currentSession }),
    );
    expect(await readJson(surviving)).not.toBeNull();

    const dead = await authGet(
      jsonRequest("/api/auth/get-session", { cookie: otherSession }),
    );
    expect(await readJson(dead)).toBeNull();
  });

  it("returns the account to single-step sign-in when disabled", async () => {
    const enrollment = await enroll();

    const disabled = await authPost(
      jsonRequest("/api/auth/two-factor/disable", {
        cookie: enrollment.cookie,
        body: { password: adminCredentials.password },
      }),
    );
    expect(disabled.status).toBe(200);

    const state = await storedTwoFactorState();
    expect(state.enabled).toBe(false);

    // The session the settings page reads after a disable (AC6).
    const disabledSession = await authGet(
      jsonRequest("/api/auth/get-session", { cookie: cookiesFrom(disabled) }),
    );
    expect(
      asObject(asObject(await readJson(disabledSession)).user).twoFactorEnabled,
    ).toBe(false);

    const signInResponse = await signIn();
    expect(signInResponse.status).toBe(200);
    const signInBody = asObject(await readJson(signInResponse));
    expect(signInBody.twoFactorRedirect).toBeUndefined();
  });

  it("serves the QR endpoint only to a session and only for totp URIs", async () => {
    const anonymous = await postQrCode(
      jsonRequest("/api/account/2fa/qrcode", {
        body: { uri: WELL_FORMED_URI },
      }),
    );
    expect(anonymous.status).toBe(401);

    const cookie = await setupAdmin();
    const badUri = await postQrCode(
      jsonRequest("/api/account/2fa/qrcode", {
        cookie,
        body: { uri: "https://example.com/not-a-totp-uri" },
      }),
    );
    expect(badUri.status).toBe(400);

    const oversized = await postQrCode(
      jsonRequest("/api/account/2fa/qrcode", {
        cookie,
        body: { uri: `otpauth://totp/${"a".repeat(600)}` },
      }),
    );
    expect(oversized.status).toBe(400);

    const ok = await postQrCode(
      jsonRequest("/api/account/2fa/qrcode", { cookie, body: { uri: WELL_FORMED_URI } }),
    );
    expect(ok.status).toBe(200);
    const payload = asObject(await readJson(ok));
    expect(String(payload.dataUrl)).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
