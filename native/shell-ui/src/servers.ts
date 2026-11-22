import type { ServerCheck } from "./host";

export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  return url.origin;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
};

function parseSemver(version: string): ParsedVersion | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  const [, major, minor, patch, pre] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: pre ? pre.split(".") : [],
  };
}

function comparePreIdentifier(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  if (!a || !b) return false;

  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;

  if (a.pre.length === 0 && b.pre.length === 0) return false;
  if (a.pre.length === 0) return true;
  if (b.pre.length === 0) return false;

  const len = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < len; i++) {
    const ai = a.pre[i];
    const bi = b.pre[i];
    if (ai === undefined) return false;
    if (bi === undefined) return true;
    const cmp = comparePreIdentifier(ai, bi);
    if (cmp !== 0) return cmp > 0;
  }
  return false;
}

export function sameMajorMinor(serverVersion: string | null, appVersion: string): boolean {
  if (serverVersion === null) return false;
  const [serverMajor, serverMinor] = serverVersion.split(".");
  const [appMajor, appMinor] = appVersion.split(".");
  return serverMajor === appMajor && serverMinor === appMinor;
}

export function classifyHealth(responseOk: boolean, body: unknown): ServerCheck {
  if (!responseOk || typeof body !== "object" || body === null || !("ok" in body) || body.ok !== true) {
    return { ok: false, reason: "not-pika" };
  }
  return { ok: true, version: "version" in body && typeof body.version === "string" ? body.version : null };
}
