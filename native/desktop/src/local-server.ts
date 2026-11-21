import { app, safeStorage, utilityProcess, type Session, type UtilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import type { Config } from "./store";

const secretsSchema = z.object({
  authSecret: z.string().min(32),
  encryptionSecret: z.string().min(32),
  adminPassword: z.string().min(16),
});

type Secrets = z.infer<typeof secretsSchema>;

// The local server inherits only what the platform needs; the user's shell env (S3_*, DEMO_MODE,
// DATABASE_URL, NODE_OPTIONS, ...) must not reconfigure it.
const INHERITED_ENV = ["PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR", "SystemRoot", "LANG", "TZ"];

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 250;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export function localPaths() {
  const root = join(app.getPath("userData"), "local");
  return {
    root,
    dbFile: join(root, "pika-chat.db"),
    filesDir: join(root, "files"),
    logFile: join(root, "server.log"),
    secretsFile: join(root, "secrets.bin"),
  };
}

function serverRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, "server") : join(__dirname, "..", "server");
}

function loadOrCreateSecrets(secretsFile: string): Secrets {
  if (existsSync(secretsFile)) {
    return secretsSchema.parse(JSON.parse(safeStorage.decryptString(readFileSync(secretsFile))));
  }

  const secrets: Secrets = {
    authSecret: randomBytes(32).toString("base64url"),
    encryptionSecret: randomBytes(32).toString("base64url"),
    adminPassword: randomBytes(24).toString("base64url"),
  };
  const encrypted = safeStorage.encryptString(JSON.stringify(secrets));
  const temp = `${secretsFile}.tmp`;
  writeFileSync(temp, encrypted);
  renameSync(temp, secretsFile);
  return secrets;
}

function probePort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const chosen = (server.address() as AddressInfo).port;
      server.close((err) => (err ? reject(err) : resolve(chosen)));
    });
  });
}

async function pickPort(preferred: number | null): Promise<number> {
  if (preferred !== null) {
    try {
      return await probePort(preferred);
    } catch {
      // Saved port is in use; pick a fresh ephemeral port below.
    }
  }
  return probePort(0);
}

async function waitForHealth(origin: string, exitPromise: Promise<string>): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // /api/health answers 200 only once the DB query succeeds; refused connections mean "not yet".
    const raced = await Promise.race([
      fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000) })
        .then((res) => res.ok)
        .catch(() => false),
      exitPromise,
    ]);
    if (typeof raced === "string") {
      throw new Error(raced);
    }
    if (raced) {
      return;
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  throw new Error("Timed out waiting for the local server to become ready.");
}

export function createLocalServer() {
  let child: UtilityProcess | null = null;
  let running: { origin: string; password: string } | null = null;
  let starting: Promise<string> | null = null;
  let lastStartupError: string | null = null;

  const startInternal = async (config: Config, saveConfig: (c: Config) => void): Promise<string> => {
    const paths = localPaths();
    mkdirSync(paths.root, { recursive: true });
    mkdirSync(paths.filesDir, { recursive: true });

    const serverDir = serverRoot();
    const secrets = loadOrCreateSecrets(paths.secretsFile);
    const port = await pickPort(config.localPort);
    if (config.localPort !== port) {
      config.localPort = port;
      saveConfig(config);
    }

    const origin = `http://127.0.0.1:${port}`;
    const logStream = createWriteStream(paths.logFile, { flags: "w" });

    const proc = utilityProcess.fork(join(serverDir, "server.js"), [], {
      cwd: serverDir,
      stdio: "pipe",
      serviceName: "Pika Chat Local Server",
      env: {
        ...Object.fromEntries(INHERITED_ENV.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]]))),
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        APP_URL: origin,
        LOCAL_MODE: "1",
        DATABASE_PATH: paths.dbFile,
        FILE_STORAGE_DIR: paths.filesDir,
        BETTER_AUTH_SECRET: secrets.authSecret,
        CREDENTIAL_ENCRYPTION_SECRET: secrets.encryptionSecret,
        LOCAL_ADMIN_PASSWORD: secrets.adminPassword,
      },
    });
    child = proc;

    proc.stdout?.pipe(logStream, { end: false });
    proc.stderr?.pipe(logStream, { end: false });

    const exitPromise = new Promise<string>((resolve) => {
      proc.once("exit", (code) => {
        if (child === proc) {
          child = null;
          running = null;
        }
        logStream.end();
        resolve(`Local server exited unexpectedly (code ${code}).`);
      });
    });

    await waitForHealth(origin, exitPromise).catch((error: unknown) => {
      proc.kill();
      throw error;
    });

    running = { origin, password: secrets.adminPassword };
    return origin;
  };

  return {
    async ensureStarted(config: Config, saveConfig: (c: Config) => void) {
      if (running) {
        return running.origin;
      }
      if (!starting) {
        lastStartupError = null;
        starting = startInternal(config, saveConfig)
          .catch((error: unknown) => {
            lastStartupError = error instanceof Error ? error.message : String(error);
            throw error;
          })
          .finally(() => {
            starting = null;
          });
      }
      return starting;
    },

    async signIn(ses: Session) {
      if (!running) throw new Error("Local server is not running");
      const { origin, password } = running;
      // get-session answers `null` when the partition has no valid session.
      if ((await ses.fetch(`${origin}/api/auth/get-session`).then((res) => res.json())) !== null) {
        return;
      }
      const res = await ses.fetch(`${origin}/api/auth/sign-in/username`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ username: "local", password }),
      });
      if (!res.ok) {
        throw new Error(`Local sign-in failed (${res.status}): ${await res.text()}`);
      }
    },

    async shutdown() {
      const proc = child;
      if (!proc) {
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          proc.kill();
          resolve();
        }, SHUTDOWN_TIMEOUT_MS);
        proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        proc.postMessage("shutdown");
      });
    },

    lastError() {
      return lastStartupError;
    },
  };
}
