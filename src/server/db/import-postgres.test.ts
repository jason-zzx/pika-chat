import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // Fall back to test defaults below when no .env is present.
}
process.env.DATABASE_PATH ??= ":memory:";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-min-32-chars";
process.env.CREDENTIAL_ENCRYPTION_SECRET ??=
  "test-credential-encryption-secret-min-32";

import {
  importFromPostgres,
  mapPgValueToSqlite,
  PG_IMPORT_TABLES,
  type OpenPostgresSource,
  type PostgresImportSource,
  sanitizeSourceInfo,
} from "./import-postgres";
import { APP_SETTINGS_ROW_ID } from "./schema/app-settings";
import { POSTGRES_IMPORT_ROW_ID } from "./schema/postgres-import";

function openMigratedMemorySqlite(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: "./src/server/db/migrations" });
  return sqlite;
}

function sqliteColumnsMap(sqlite: Database.Database): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const table of PG_IMPORT_TABLES) {
    const rows = sqlite
      .prepare(`pragma table_info("${table}")`)
      .all() as Array<{ name: string }>;
    out[table] = rows.map((row) => row.name);
  }
  return out;
}

function createFakeOpenSource(
  tableData: Partial<Record<(typeof PG_IMPORT_TABLES)[number], Record<string, unknown>[]>>,
  options?: {
    columnsOverride?: Record<string, string[]>;
    onStream?: (table: string) => void;
  },
): { openSource: OpenPostgresSource; calls: number } {
  const tracker = {
    calls: 0,
    openSource: (async (_url, fn) => {
      tracker.calls += 1;
      const source: PostgresImportSource = {
        async listColumns() {
          return options?.columnsOverride ?? {};
        },
        async countRows(table) {
          return (tableData[table] ?? []).length;
        },
        async streamRows(table, batchSize, onBatch) {
          options?.onStream?.(table);
          const rows = tableData[table] ?? [];
          for (let offset = 0; offset < rows.length; offset += batchSize) {
            onBatch(rows.slice(offset, offset + batchSize));
          }
        },
      };
      return fn(source);
    }) as OpenPostgresSource,
  };
  return tracker;
}

describe("import-postgres", () => {
  const openDbs: Database.Database[] = [];
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    for (const sqlite of openDbs.splice(0)) {
      sqlite.close();
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    vi.resetModules();
  });

  function freshSqlite(): Database.Database {
    const sqlite = openMigratedMemorySqlite();
    openDbs.push(sqlite);
    return sqlite;
  }

  it("sanitizes PostgreSQL URLs without leaking credentials or query parameters", () => {
    expect(
      sanitizeSourceInfo("postgres://pika:super-secret@pg.internal:5432/pika_chat?sslmode=require"),
    ).toEqual({ host: "pg.internal:5432", database: "pika_chat" });
    expect(sanitizeSourceInfo("not-a-url")).toEqual({
      host: null,
      database: null,
    });
  });

  it("converts PostgreSQL column values to SQLite representations cleanly", () => {
    expect(mapPgValueToSqlite("boolean", true, "b")).toBe(1);
    expect(mapPgValueToSqlite("boolean", false, "b")).toBe(0);
    expect(mapPgValueToSqlite("boolean", null, "b")).toBeNull();

    const ts = new Date("2026-01-15T12:30:00.123Z");
    expect(mapPgValueToSqlite("date", ts, "ts")).toBe(ts.getTime());
    expect(mapPgValueToSqlite("number", "5368709120", "quota")).toBe(5368709120);
    expect(mapPgValueToSqlite("number", BigInt(1024), "quota")).toBe(1024);

    expect(
      mapPgValueToSqlite("string", new Date("2026-11-13T00:00:00.000Z"), "day"),
    ).toBe("2026-11-13");
    expect(mapPgValueToSqlite("json", { chat: { providerConfigId: "p1", modelId: "m1" } }, "prefs")).toBe(
      '{"chat":{"providerConfigId":"p1","modelId":"m1"}}',
    );
    expect(mapPgValueToSqlite("json", "plain-json-string", "j")).toBe(
      '"plain-json-string"',
    );
    expect(() => mapPgValueToSqlite("number", "not-an-int", "n")).toThrow();
  });

  it("skips cleanly on boot when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { maybeImportPostgres: freshMaybeImport } = await import("./import-postgres");

    expect(await freshMaybeImport()).toEqual({
      status: "skipped",
      reason: "noDatabaseUrl",
    });
  });

  it("refuses to import into a non-empty SQLite target", async () => {
    const sqlite = freshSqlite();
    const now = Date.now();
    sqlite
      .prepare(
        "insert into users (id, name, email, username, role, email_verified, banned, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("u1", "Alice", "alice@test", "alice", "super_admin", 1, 0, now, now);

    const tracker = createFakeOpenSource({}, { columnsOverride: sqliteColumnsMap(sqlite) });
    await expect(
      importFromPostgres("postgres://u:p@localhost:5432/pika", {
        sqlite,
        openSource: tracker.openSource,
      }),
    ).rejects.toThrow(/target SQLite table "users" is not empty/i);
    expect(tracker.calls).toBe(0);

    // Non-default app_settings row is also rejected.
    const sqlite2 = freshSqlite();
    sqlite2
      .prepare(
        "insert into app_settings (id, allow_registration, created_at, updated_at) values (?, ?, ?, ?)",
      )
      .run("custom-row", 0, now, now);
    await expect(
      importFromPostgres("postgres://u:p@localhost:5432/pika", {
        sqlite: sqlite2,
        openSource: tracker.openSource,
      }),
    ).rejects.toThrow(/target SQLite table "app_settings" is not empty/i);
  });

  it("refuses when PostgreSQL schema columns do not match SQLite", async () => {
    const sqlite = freshSqlite();
    const cols = sqliteColumnsMap(sqlite);
    cols.topics = (cols.topics ?? []).filter((c) => c !== "summary_text");
    cols.topics.push("legacy_col");

    const tracker = createFakeOpenSource({}, { columnsOverride: cols });
    await expect(
      importFromPostgres("postgres://u:p@localhost:5432/pika", {
        sqlite,
        openSource: tracker.openSource,
      }),
    ).rejects.toThrow(/Schema mismatch for table "topics"/i);
  });

  it("imports all tables in 1000-row batches, triggers message_file_refs, writes marker, and skips re-runs", async () => {
    const sqlite = freshSqlite();
    const cols = sqliteColumnsMap(sqlite);
    const createdAt = new Date("2026-06-01T10:00:00.123Z");
    const counters = Array.from({ length: 1_250 }, (_, index) => ({
      subject: `guest-${index}`,
      day: new Date("2026-11-13T00:00:00.000Z"),
      kind: "model",
      count: index + 1,
    }));

    const tracker = createFakeOpenSource(
      {
        app_settings: [
          {
            id: APP_SETTINGS_ROW_ID,
            allow_registration: true,
            file_storage_quota_bytes: "5368709120",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        users: [
          {
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
          },
        ],
        sessions: [
          {
            id: "s1",
            expires_at: new Date("2026-07-01T00:00:00.000Z"),
            token: "tok-1",
            created_at: createdAt,
            updated_at: createdAt,
            ip_address: "127.0.0.1",
            user_agent: "vitest",
            user_id: "u1",
            impersonated_by: null,
          },
        ],
        accounts: [
          {
            id: "acc1",
            issuer: "credential",
            account_id: "u1",
            provider_id: "credential",
            user_id: "u1",
            access_token: null,
            refresh_token: null,
            id_token: null,
            access_token_expires_at: null,
            refresh_token_expires_at: null,
            scope: null,
            password: "hash",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        verifications: [
          {
            id: "v1",
            identifier: "admin@test",
            value: "code",
            expires_at: createdAt,
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        two_factors: [
          {
            id: "tf1",
            secret: "sec",
            backup_codes: "codes",
            user_id: "u1",
            verified: true,
            failed_verification_count: 0,
            locked_until: null,
          },
        ],
        provider_configs: [
          {
            id: "p1",
            owner_id: "u1",
            name: "OpenAI",
            base_url: "https://api.openai.com/v1",
            api_format: "openai-compatible",
            encrypted_api_key: "enc",
            api_key_last_four: "1234",
            visibility: "shared",
            enabled: true,
            files_api_unsupported_at: null,
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        provider_models: [
          {
            id: "pm1",
            provider_config_id: "p1",
            model_id: "gpt-4o",
            context_tokens: 128_000,
            output_tokens: 4_096,
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
            reasoning: false,
            reasoning_options: [],
            vendor_key: "openai",
            metadata_source: "manual",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        assistants: [
          {
            id: "agt_1",
            owner_id: "u1",
            name: "Default",
            icon: "✨",
            system_prompt: null,
            default_provider_config_id: "p1",
            default_model_id: "gpt-4o",
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
        chat_generations: [
          {
            id: "gen_1",
            user_id: "u1",
            request_id: "req_1",
            request_hash: "hash",
            request_expires_at: createdAt,
            kind: "send",
            status: "completed",
            topic_id: "tpc_1",
            assistant_message_id: "msg_1",
            target_deleted_at: null,
            input: { topicId: "tpc_1" },
            error_message: null,
            created_at: createdAt,
            updated_at: createdAt,
            started_at: createdAt,
            finished_at: createdAt,
          },
        ],
        files: [
          {
            id: "f1",
            user_id: "u1",
            filename: "a.png",
            media_type: "image/png",
            size_bytes: "1234",
            storage_key: "u1/f1.png",
            extracted_text: null,
            extraction_status: "none",
            extraction_truncated: false,
            provider_references: { p1: { reference: { google: "files/1" } } },
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        provider_file_delete_retries: [
          {
            id: "r1",
            provider_config_id: "p1",
            provider_file_id: "files/old",
            attempts: 1,
            next_retry_at: createdAt,
            last_status: 503,
            created_at: createdAt,
          },
        ],
        search_provider_settings: [
          {
            id: "sp1",
            user_id: "u1",
            provider: "brave",
            encrypted_api_key: "enc",
            api_key_last_four: "9999",
            base_url: null,
            position: 0,
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        demo_usage_counters: counters,
      },
      { columnsOverride: cols },
    );

    const first = await importFromPostgres("postgres://pika:secret@pg-host:5432/pika_prod", {
      sqlite,
      openSource: tracker.openSource,
    });
    expect(first).toMatchObject({
      status: "imported",
      messageFileRefs: 1,
    });
    expect(tracker.calls).toBe(1);

    const settings = sqlite
      .prepare("select allow_registration, file_storage_quota_bytes from app_settings where id = ?")
      .get(APP_SETTINGS_ROW_ID) as {
      allow_registration: number;
      file_storage_quota_bytes: number;
    };
    expect(settings).toEqual({
      allow_registration: 1,
      file_storage_quota_bytes: 5368709120,
    });

    expect(
      (sqlite.prepare("select count(*) as c from demo_usage_counters").get() as { c: number }).c,
    ).toBe(1_250);
    expect(
      sqlite.prepare("select day from demo_usage_counters where subject = 'guest-0'").get(),
    ).toEqual({ day: "2026-11-13" });
    expect(
      sqlite.prepare("select file_id from message_file_refs where message_id = 'msg_1'").get(),
    ).toEqual({ file_id: "f1" });

    const marker = sqlite
      .prepare("select id, source_info, row_counts from postgres_import where id = ?")
      .get(POSTGRES_IMPORT_ROW_ID) as {
      id: string;
      source_info: string;
      row_counts: string;
    };
    expect(marker.id).toBe(POSTGRES_IMPORT_ROW_ID);
    expect(JSON.parse(marker.source_info)).toEqual({
      host: "pg-host:5432",
      database: "pika_prod",
    });
    expect(marker.source_info).not.toContain("secret");
    expect(JSON.parse(marker.row_counts)).toMatchObject({
      users: 1,
      demo_usage_counters: 1_250,
    });

    // Second run sees marker and skips without touching PG.
    const second = await importFromPostgres("postgres://pika:secret@pg-host:5432/pika_prod", {
      sqlite,
      openSource: tracker.openSource,
    });
    expect(second).toEqual({ status: "skipped", reason: "alreadyImported" });
    expect(tracker.calls).toBe(1);
  });

  it("rolls back completely when foreign_key_check fails or streaming aborts", async () => {
    const sqlite = freshSqlite();
    const cols = sqliteColumnsMap(sqlite);
    const createdAt = new Date("2026-06-01T10:00:00.000Z");

    const tracker = createFakeOpenSource(
      {
        app_settings: [
          {
            id: APP_SETTINGS_ROW_ID,
            allow_registration: true,
            file_storage_quota_bytes: "5368709120",
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        // Topic references nonexistent assistant_id -> fails PRAGMA foreign_key_check.
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
      },
      { columnsOverride: cols },
    );

    await expect(
      importFromPostgres("postgres://pika:secret@pg:5432/pika", {
        sqlite,
        openSource: tracker.openSource,
      }),
    ).rejects.toThrow(/Foreign key check failed/i);

    // Marker not written, orphan topic rolled back, seeded app_settings intact!
    expect(
      sqlite.prepare("select count(*) as c from postgres_import").get(),
    ).toEqual({ c: 0 });
    expect(
      sqlite.prepare("select count(*) as c from topics").get(),
    ).toEqual({ c: 0 });
    expect(
      sqlite.prepare("select allow_registration from app_settings where id = ?").get(APP_SETTINGS_ROW_ID),
    ).toEqual({ allow_registration: 0 });

    // Stream error mid-import also rolls back cleanly.
    const failingOpenSource: OpenPostgresSource = async (_url, fn) =>
      fn({
        async listColumns() {
          return cols;
        },
        async countRows(table) {
          return table === "users" ? 1 : 0;
        },
        async streamRows(table, _batchSize, onBatch) {
          if (table === "users") {
            onBatch([
              {
                id: "u-partial",
                name: "Partial",
                email: "partial@test",
                email_verified: true,
                two_factor_enabled: false,
                image: null,
                username: "partial",
                display_username: "Partial",
                role: "user",
                is_anonymous: false,
                file_quota_bytes: null,
                theme_mode: "system",
                theme_preset: "default",
                model_preferences: {},
                banned: false,
                ban_reason: null,
                ban_expires: null,
                created_at: createdAt,
                updated_at: createdAt,
              },
            ]);
            throw new Error("pg connection dropped mid-stream");
          }
        },
      });

    await expect(
      importFromPostgres("postgres://pika:secret@pg:5432/pika", {
        sqlite,
        openSource: failingOpenSource,
      }),
    ).rejects.toThrow("pg connection dropped mid-stream");
    expect(sqlite.prepare("select count(*) as c from users").get()).toEqual({ c: 0 });
    expect(sqlite.prepare("select count(*) as c from postgres_import").get()).toEqual({ c: 0 });
  });
});
