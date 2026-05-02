#!/usr/bin/env -S tsx
import { runCli } from "./cli.ts";
import { logger } from "./logger.ts";

runCli(process.argv).catch((err: unknown) => {
  logger.fatal({ err }, "fatal cli error");
  process.exit(1);
});
