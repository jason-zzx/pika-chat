import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, type Locale } from "./locales";

import { setLocaleCookie } from "./actions";

const { setCookie } = vi.hoisted(() => ({ setCookie: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setCookie }),
}));

describe("setLocaleCookie", () => {
  beforeEach(() => {
    setCookie.mockReset();
  });

  it("persists a supported locale with the theme-matching cookie attributes", async () => {
    await setLocaleCookie("zh-CN");

    expect(setCookie).toHaveBeenCalledTimes(1);
    expect(setCookie).toHaveBeenCalledWith(LOCALE_COOKIE_NAME, "zh-CN", {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  });

  it("ignores a value outside the catalog", async () => {
    // Server Action input is runtime data; anything unsupported is a no-op.
    await setLocaleCookie("fr" as unknown as Locale);

    expect(setCookie).not.toHaveBeenCalled();
  });
});
