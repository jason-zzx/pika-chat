import "server-only";

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: isProduction ? "info" : "debug",
  redact: {
    paths: [
      "authorization",
      "cookie",
      "apiKey",
      "set-cookie",
      "password",
      "token",
      "*.password",
      "*.token",
    ],
    censor: "[Redacted]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
