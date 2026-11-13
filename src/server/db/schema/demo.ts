import { date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

export const demoUsageCounters = pgTable(
  "demo_usage_counters",
  {
    subject: text("subject").notNull(),
    day: date("day", { mode: "string" }).notNull(),
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
