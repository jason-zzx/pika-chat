import { app } from "electron";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const DEFAULT_HOTKEY = "CommandOrControl+Shift+Space";

export const closeActionSchema = z.enum(["tray", "quit"]);
export type CloseAction = z.infer<typeof closeActionSchema>;

// Preset names are not enumerated: shell-ui falls back to the default tokens for one it does not know.
export const appearanceSchema = z.object({
  mode: z.enum(["light", "dark", "system"]),
  preset: z.string().regex(/^[a-z0-9-]{1,32}$/),
});

// Each field falls back on its own, so one bad value does not discard the server list.
const configSchema = z.object({
  servers: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })).catch([]),
  lastServerId: z.string().nullable().catch(null),
  // When the shell last switched to lastServerId; the web app drops drafts written before it.
  connectedSince: z.number().catch(0),
  localPort: z.number().int().positive().nullable().catch(null),
  hotkey: z.string().nullable().catch(DEFAULT_HOTKEY),
  closeAction: closeActionSchema.catch("tray"),
  notificationsEnabled: z.boolean().catch(true),
  developerMode: z.boolean().catch(false),
  appearance: appearanceSchema.catch({ mode: "system", preset: "default" }),
  windowState: z
    .object({
      bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
      isMaximized: z.boolean(),
    })
    .nullable()
    .catch(null),
});

export type Config = z.infer<typeof configSchema>;

const file = () => join(app.getPath("userData"), "config.json");

export function loadConfig(): Config {
  try {
    return configSchema.parse(JSON.parse(readFileSync(file(), "utf8")));
  } catch {
    // First launch or an unreadable file: start from defaults.
    return configSchema.parse({});
  }
}

export function saveConfig(config: Config) {
  const temp = `${file()}.tmp`;
  writeFileSync(temp, JSON.stringify(config, null, 2));
  renameSync(temp, file());
}
