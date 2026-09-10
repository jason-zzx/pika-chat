import { describe, expect, it } from "vitest";

import { TOTP_URI_MAX_LENGTH, qrCodeSchema } from "./two-factor";

const WELL_FORMED =
  "otpauth://totp/Pika%20chat:member@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Pika%20chat&digits=6&period=30";

describe("qrCodeSchema", () => {
  it("accepts a well-formed totp URI", () => {
    expect(qrCodeSchema.safeParse({ uri: WELL_FORMED }).success).toBe(true);
  });

  it("rejects a non-otpauth scheme", () => {
    expect(
      qrCodeSchema.safeParse({ uri: `https://totp/x?secret=ABC` }).success,
    ).toBe(false);
  });

  it("rejects another otp type", () => {
    expect(
      qrCodeSchema.safeParse({
        uri: "otpauth://hotp/Pika%20chat:member@example.com?secret=JBSWY3DPEHPK3PXP",
      }).success,
    ).toBe(false);
  });

  it("rejects an oversized URI", () => {
    const uri = `otpauth://totp/${"a".repeat(TOTP_URI_MAX_LENGTH)}`;
    expect(uri.length).toBeGreaterThan(TOTP_URI_MAX_LENGTH);
    expect(qrCodeSchema.safeParse({ uri }).success).toBe(false);
  });

  it("rejects a missing or non-string uri", () => {
    expect(qrCodeSchema.safeParse({}).success).toBe(false);
    expect(qrCodeSchema.safeParse({ uri: 42 }).success).toBe(false);
  });
});
