import { sql } from "drizzle-orm";
import { integer } from "drizzle-orm/sqlite-core";

export const timestampMs = (name: string) =>
  integer(name, { mode: "timestamp_ms" });

export const timestampMsDefaultNow = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);
