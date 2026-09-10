const TOTP_CODE = /^\d{6}$/;

/**
 * True when `code` has the shape of a TOTP code, false for anything a backup
 * code could look like.
 *
 * The challenge form dispatches on shape rather than a UI toggle: TOTP codes
 * are exactly six digits, while better-auth backup codes are always
 * `XXXXX-XXXXX` (11 characters, one hyphen), so the two never collide.
 */
export function isTotpCode(code: string): boolean {
  return TOTP_CODE.test(code);
}

/**
 * True when `name` is better-auth's pending-challenge cookie.
 *
 * The challenge is bound to a signed cookie rather than to anything in the
 * sign-in response body, so this suffix is the only client-visible signal that
 * a second step is in flight. better-auth prefixes secure cookies with
 * `__Secure-` when `BETTER_AUTH_URL` is https, hence the suffix match rather
 * than equality with `two_factor`.
 */
export function isChallengeCookie(name: string): boolean {
  return name.endsWith("two_factor");
}
