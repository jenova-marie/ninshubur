import pino from "pino";
import { env } from "./config.ts";

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino/file",
          options: { destination: 1 },
        },
      }
    : {}),
  base: { service: "ninshubur" },
});

export type Logger = typeof logger;
