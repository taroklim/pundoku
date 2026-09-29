import pino from "pino";
import { env } from "../config/env.js";

export type Logger = pino.Logger;

export function createLogger(level: string = env.logLevel): Logger {
  return pino({
    level,
    // Токен устройства никогда не должен попасть в лог.
    redact: { paths: ["req.headers.authorization", "headers.authorization"], censor: "Bearer [redacted]" },
    ...(env.nodeEnv === "development" && level !== "silent"
      ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
      : {}),
  });
}
