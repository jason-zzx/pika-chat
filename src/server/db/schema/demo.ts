import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const demoUsageCounters = sqliteTable(
  "demo_usage_counters",
  {
    subject: text("subject").notNull(),
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.subject, table.day, table.kind],
      name: "demo_usage_counters_pk",
    }),
  ],
);
