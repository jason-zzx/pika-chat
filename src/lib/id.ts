import { v7 as uuidv7 } from "uuid";

/** Application-generated UUIDv7. Shared by auth tables and every later domain table. */
export function newId(): string {
  return uuidv7();
}
