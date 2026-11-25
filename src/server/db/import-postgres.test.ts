import { inspect } from "node:util";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  importFromPostgres,
  mapPgValueToSqlite,
  PG_IMPORT_TABLES,
  type OpenPostgresSource,
  type PostgresImportSource,
} from "./import-postgres";
import { APP_SETTINGS_ROW_ID } from "./schema/app-settings";
import { POSTGRES_IMPORT_ROW_ID } from "./schema/postgres-import";

// Port 1 refuses connections immediately, so the real postgres.js client
// fails fast without a PostgreSQL server.
const UNREACHABLE_URL = "postgres://pika:super-secret@127.0.0.1:1/pika_chat";

type TableRows = Record<string, Record<string, unknown>[]>;

const openDbs: Database.Database[] = [];

function freshSqlite(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: "./src/server/db/migrations" });
  openDbs.push(sqlite);
  return sqlite;
}

// What `information_schema.columns` reports for a PostgreSQL database on the
// final (v0.4.2) schema: the migrated SQLite tables minus the columns added
// after the SQLite switch.
function finalSchemaColumns(sqlite: Database.Database): Record<string, string[]> {
  return Object.fromEntries(
    PG_IMPORT_TABLES.map((table) => [
      table,
      sqlite
        .prepare<[], string>(`select name from pragma_table_info('${table}')`)
        .pluck()
        .all()
        .filter((name) => !(table === "topics" && name === "temporary")),
    ]),
  );
}

function fakeSource(
  columns: Record<string, string[]>,
  rows: TableRows,
): { openSource: OpenPostgresSource; opened: number; batchSizes: number[] } {
  const tracker = {
    opened: 0,
    batchSizes: [] as number[],
    openSource: (async (_url, fn) => {
      tracker.opened += 1;
      const source: PostgresImportSource = {
        async listColumns() {
          return columns;
        },
        async countRows(table) {
          return (rows[table] ?? []).length;
        },
        async streamRows(table, batchSize, onBatch) {
          tracker.batchSizes.push(batchSize);
          const tableRows = rows[table] ?? [];
          for (let offset = 0; offset < tableRows.length; offset += batchSize) {
            onBatch(tableRows.slice(offset, offset + batchSize));
          }
        },
      };
      return fn(source);
    }) as OpenPostgresSource,
  };
  return tracker;
}

function count(sqlite: Database.Database, table: string): number | undefined {
  return sqlite
    .prepare<[], number>(`select count(*) from "${table}"`)
    .pluck()
    .get();
}

function foreignKeysOn(sqlite: Database.Database): unknown {
  return sqlite.pragma("foreign_keys", { simple: true });
}

const createdAt = new Date("2026-06-01T10:00:00.123Z");

const sourceAppSettings = {
  id: APP_SETTINGS_ROW_ID,
  allow_registration: true,
  file_storage_quota_bytes: "5368709120",
  created_at: createdAt,
  updated_at: createdAt,
};

const sourceUser = {
  id: "u1",
  name: "Admin",
  email: "admin@test",
  email_verified: true,
  two_factor_enabled: false,
  image: null,
  username: "admin",
  display_username: "Admin",
  role: "super_admin",
  is_anonymous: false,
  file_quota_bytes: "1073741824",
  theme_mode: "dark",
  theme_preset: "ocean",
  model_preferences: { chat: { providerConfigId: "p1", modelId: "gpt-4o" } },
  banned: false,
  ban_reason: null,
  ban_expires: null,
  created_at: createdAt,
  updated_at: createdAt,
};

afterEach(() => {
  for (const sqlite of openDbs.splice(0)) {
    sqlite.close();
  }
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

describe("value mapping", () => {
  it("maps postgres.js values onto the SQLite column storage form", () => {
    expect(mapPgValueToSqlite("boolean", true)).toBe(1);
    expect(mapPgValueToSqlite("boolean", false)).toBe(0);
    expect(mapPgValueToSqlite("date", createdAt)).toBe(createdAt.getTime());
    // PostgreSQL `date` is a UTC-midnight Date; the SQLite column is text.
    expect(
      mapPgValueToSqlite("string", new Date("2026-11-13T00:00:00.000Z")),
    ).toBe("2026-11-13");
    // int8 arrives as a string.
    expect(mapPgValueToSqlite("number", "5368709120")).toBe(5368709120);
    expect(mapPgValueToSqlite("number", 42)).toBe(42);
    expect(mapPgValueToSqlite("string", "text")).toBe("text");
    for (const dataType of ["boolean", "date", "json", "number", "string"]) {
      expect(mapPgValueToSqlite(dataType, null)).toBeNull();
    }
  });

  it("stringifies JSON by column type, so jsonb scalars stay valid JSON", () => {
    expect(mapPgValueToSqlite("json", { a: { b: [1] } })).toBe('{"a":{"b":[1]}}');
    expect(mapPgValueToSqlite("json", ["text", "image"])).toBe('["text","image"]');
    expect(mapPgValueToSqlite("json", "plain")).toBe('"plain"');
    expect(mapPgValueToSqlite("json", 7)).toBe("7");
    expect(mapPgValueToSqlite("json", false)).toBe("false");
  });
});

describe("table coverage", () => {
  it("copies every migrated table except the SQLite-only refs and marker", () => {
    const sqlite = freshSqlite();
    const tables = sqlite
      .prepare<[], string>(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations'",
      )
      .pluck()
      .all();
    expect([...PG_IMPORT_TABLES].sort()).toEqual(
      tables.filter((name) => name !== "message_file_refs" && name !== "postgres_import").sort(),
    );
  });
});

describe("boot decision", () => {
  it("does nothing on a fresh install without DATABASE_URL", async () => {
    const { maybeImportPostgres } = await import("./import-postgres");
    expect(await maybeImportPostgres()).toEqual({
      status: "skipped",
      reason: "noDatabaseUrl",
    });
  });

  it("ignores DATABASE_URL once the marker exists, without connecting", async () => {
    process.env.DATABASE_URL = UNREACHABLE_URL;
    const { getDb, getSqliteClient } = await import("./client");
    migrate(getDb(), { migrationsFolder: "./src/server/db/migrations" });
    const sqlite = getSqliteClient();
    sqlite
      .prepare("insert into postgres_import (id, source_info, row_counts) values (?, '{}', '{}')")
      .run(POSTGRES_IMPORT_ROW_ID);
    try {
      const { maybeImportPostgres } = await import("./import-postgres");
      expect(await maybeImportPostgres()).toEqual({
        status: "skipped",
        reason: "alreadyImported",
      });
    } finally {
      sqlite.prepare("delete from postgres_import").run();
    }
  });

  it("fails with a readable error when PostgreSQL is unreachable and leaves SQLite untouched", async () => {
    const sqlite = freshSqlite();
    const error: unknown = await importFromPostgres(UNREACHABLE_URL, {
      sqlite,
    }).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      message: expect.stringMatching(
        /Keep PostgreSQL running with its existing connection settings for the first boot/,
      ),
      cause: { code: "ECONNREFUSED" },
    });
    // Boot failures are printed with their cause chain.
    expect(inspect(error)).not.toContain("super-secret");
    expect(count(sqlite, "postgres_import")).toBe(0);
    expect(foreignKeysOn(sqlite)).toBe(1);
  });
});

describe("refusals", () => {
  it("refuses a non-empty target before opening PostgreSQL", async () => {
    const sqlite = freshSqlite();
    const now = Date.now();
    sqlite
      .prepare(
        "insert into users (id, name, email, username, role, email_verified, banned, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("u1", "Alice", "alice@test", "alice", "super_admin", 1, 0, now, now);
    const source = fakeSource(finalSchemaColumns(sqlite), {});
    await expect(
      importFromPostgres(UNREACHABLE_URL, { sqlite, openSource: source.openSource }),
    ).rejects.toThrow(/SQLite table "users" already holds data/);
    expect(source.opened).toBe(0);
  });

  it("refuses a PostgreSQL schema that is not on the final migration", async () => {
    const sqlite = freshSqlite();
    const changed = finalSchemaColumns(sqlite);
    changed.topics = (changed.topics ?? [])
      .filter((name) => name !== "summary_text")
      .concat("legacy_col");
    await expect(
      importFromPostgres(UNREACHABLE_URL, {
        sqlite,
        openSource: fakeSource(changed, {}).openSource,
      }),
    ).rejects.toThrow(
      /"topics" is not on the expected schema \(missing columns: \[summary_text\]; unexpected columns: \[legacy_col\]\)\. Upgrade to v0\.4\.2 first/,
    );

    const olderRelease = Object.fromEntries(
      Object.entries(finalSchemaColumns(sqlite)).filter(
        ([table]) => table !== "chat_generations",
      ),
    );
    await expect(
      importFromPostgres(UNREACHABLE_URL, {
        sqlite,
        openSource: fakeSource(olderRelease, {}).openSource,
      }),
    ).rejects.toThrow(/"chat_generations" is not on the expected schema/);
    expect(count(sqlite, "postgres_import")).toBe(0);
    expect(foreignKeysOn(sqlite)).toBe(1);
  });
});

describe("import", () => {
  it("copies rows in 1,000-row batches, fills message_file_refs, and writes the marker", async () => {
    const sqlite = freshSqlite();
    const counters = Array.from({ length: 1_250 }, (_, index) => ({
      subject: `guest-${index}`,
      day: new Date("2026-11-13T00:00:00.000Z"),
      kind: "model",
      count: index + 1,
    }));
    const source = fakeSource(finalSchemaColumns(sqlite), {
      app_settings: [sourceAppSettings],
      users: [sourceUser],
      assistants: [
        {
          id: "agt_1",
          owner_id: "u1",
          name: "Default",
          icon: "✨",
          system_prompt: null,
          default_provider_config_id: null,
          default_model_id: null,
          created_at: createdAt,
          updated_at: createdAt,
        },
      ],
      topics: [
        {
          id: "tpc_1",
          assistant_id: "agt_1",
          title: "Imported Topic",
          is_favorite: true,
          summary_text: null,
          summary_up_to_message_id: null,
          created_at: createdAt,
          updated_at: createdAt,
        },
      ],
      chat_messages: [
        {
          id: "msg_1",
          topic_id: "tpc_1",
          role: "user",
          parts: [
            { type: "file", url: "/api/files/f1", mediaType: "image/png", filename: "a.png" },
            { type: "text", text: "See attached" },
          ],
          outcome: null,
          error_message: null,
          provider_config_id: null,
          model_id: null,
          reasoning_ms: null,
          usage: null,
          finish_reason: null,
          translations: { "zh-CN": { text: "见附件" } },
          group_id: "msg_1",
          is_selected: true,
          created_at: createdAt,
          group_created_at: createdAt,
        },
      ],
      files: [
        {
          id: "f1",
          user_id: "u1",
          filename: "a.png",
          media_type: "image/png",
          size_bytes: 1234,
          storage_key: "u1/f1.png",
          extracted_text: null,
          extraction_status: "none",
          extraction_truncated: false,
          provider_references: { p1: { reference: { google: "files/1" } } },
          created_at: createdAt,
          updated_at: createdAt,
        },
      ],
      demo_usage_counters: counters,
    });

    const first = await importFromPostgres(
      "postgres://pika:secret@pg-host:5432/pika_prod",
      { sqlite, openSource: source.openSource },
    );
    expect(first).toMatchObject({
      status: "imported",
      rowCounts: { users: 1, chat_messages: 1, demo_usage_counters: 1_250 },
    });
    expect(source.batchSizes.every((size) => size === 1_000)).toBe(true);
    expect(foreignKeysOn(sqlite)).toBe(1);

    expect(
      sqlite
        .prepare("select allow_registration, file_storage_quota_bytes from app_settings")
        .all(),
    ).toEqual([{ allow_registration: 1, file_storage_quota_bytes: 5368709120 }]);
    expect(count(sqlite, "demo_usage_counters")).toBe(1_250);
    expect(
      sqlite.prepare("select day from demo_usage_counters where subject = 'guest-0'").get(),
    ).toEqual({ day: "2026-11-13" });
    expect(
      sqlite.prepare("select created_at, is_favorite, temporary from topics").get(),
    ).toEqual({ created_at: createdAt.getTime(), is_favorite: 1, temporary: 0 });
    expect(
      sqlite.prepare("select translations ->> '$.zh-CN.text' as text from chat_messages").get(),
    ).toEqual({ text: "见附件" });
    expect(sqlite.prepare("select message_id, file_id from message_file_refs").all()).toEqual([
      { message_id: "msg_1", file_id: "f1" },
    ]);

    const marker = sqlite
      .prepare<[], { source_info: string; row_counts: string }>(
        "select source_info, row_counts from postgres_import",
      )
      .get();
    expect(JSON.parse(marker?.source_info ?? "")).toEqual({
      host: "pg-host:5432",
      database: "pika_prod",
    });
    expect(marker?.source_info).not.toContain("secret");
    expect(JSON.parse(marker?.row_counts ?? "")).toMatchObject({
      users: 1,
      demo_usage_counters: 1_250,
    });
  });

  it("rolls back everything on a failed copy, so the next boot retries", async () => {
    const sqlite = freshSqlite();
    const columns = finalSchemaColumns(sqlite);

    await expect(
      importFromPostgres(UNREACHABLE_URL, {
        sqlite,
        openSource: fakeSource(columns, {
          app_settings: [sourceAppSettings],
          topics: [
            {
              id: "tpc_orphan",
              assistant_id: "missing_agt",
              title: "Orphan",
              is_favorite: false,
              summary_text: null,
              summary_up_to_message_id: null,
              created_at: createdAt,
              updated_at: createdAt,
            },
          ],
        }).openSource,
      }),
    ).rejects.toThrow(/Foreign key check failed .* first in "topics" referencing "assistants"/);
    expect(count(sqlite, "topics")).toBe(0);
    expect(count(sqlite, "postgres_import")).toBe(0);
    // The seeded row is back: the delete that preceded the copy rolled back.
    expect(
      sqlite.prepare("select id, allow_registration from app_settings").all(),
    ).toEqual([{ id: APP_SETTINGS_ROW_ID, allow_registration: 0 }]);
    expect(foreignKeysOn(sqlite)).toBe(1);
    expect(sqlite.inTransaction).toBe(false);

    expect(
      await importFromPostgres(UNREACHABLE_URL, {
        sqlite,
        openSource: fakeSource(columns, {
          app_settings: [sourceAppSettings],
          users: [sourceUser],
        }).openSource,
      }),
    ).toMatchObject({ status: "imported", rowCounts: { users: 1 } });
    expect(count(sqlite, "postgres_import")).toBe(1);
  });
});
