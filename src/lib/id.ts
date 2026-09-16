import { v7 as uuidv7 } from "uuid";

/** Application-generated UUIDv7. Shared by auth tables and every later domain table. */
export function newId(): string {
  return uuidv7();
}

/**
 * Short prefixed ids (e.g. `agt_GC4KNOL3BhVE`) for entities exposed in URLs.
 * 12 base62 chars ≈ 71 bits of entropy — collision-safe at this app's scale and
 * short enough to keep assistant/topic URLs compact. Existing uuidv7 rows stay
 * valid: id columns are plain text and nothing validates the format.
 */
const SHORT_ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SHORT_ID_LENGTH = 12;

export function newShortId(prefix: string): string {
  // Modulo bias only touches the first 8 alphabet chars (5/256 vs 4/256);
  // immaterial for an identifier, so no rejection sampling.
  const token = Array.from(
    crypto.getRandomValues(new Uint8Array(SHORT_ID_LENGTH)),
    (byte) => SHORT_ID_ALPHABET.charAt(byte % SHORT_ID_ALPHABET.length),
  ).join("");
  return `${prefix}_${token}`;
}

export function newAssistantId(): string {
  return newShortId("agt");
}

export function newTopicId(): string {
  return newShortId("tpc");
}
