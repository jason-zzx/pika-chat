import { describe, expect, it } from "vitest";

import { isChallengeCookie, isTotpCode } from "./two-factor";

describe("isTotpCode", () => {
  it("accepts exactly six digits", () => {
    expect(isTotpCode("123456")).toBe(true);
    expect(isTotpCode("000000")).toBe(true);
  });

  it("rejects the backup-code shape", () => {
    expect(isTotpCode("aB3dE-7xK9p")).toBe(false);
    expect(isTotpCode("12345-67890")).toBe(false);
  });

  it("rejects anything that is not six digits", () => {
    expect(isTotpCode("12345")).toBe(false);
    expect(isTotpCode("1234567")).toBe(false);
    expect(isTotpCode("123 56")).toBe(false);
    expect(isTotpCode(" 123456")).toBe(false);
    expect(isTotpCode("12345a")).toBe(false);
    expect(isTotpCode("")).toBe(false);
  });
});

describe("isChallengeCookie", () => {
  it("matches the plain and the secure-prefixed cookie name", () => {
    expect(isChallengeCookie("two_factor")).toBe(true);
    expect(isChallengeCookie("__Secure-two_factor")).toBe(true);
  });

  it("ignores other cookies", () => {
    expect(isChallengeCookie("better-auth.session_token")).toBe(false);
    expect(isChallengeCookie("two_factor_attempts")).toBe(false);
    expect(isChallengeCookie("")).toBe(false);
  });
});
