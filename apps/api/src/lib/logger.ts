import pino from "pino";
import { env } from "../config/env.js";

export type Logger = pino.Logger;

/**
 * Пути, значения которых никогда не попадают в лог: токен устройства и ключ восстановления (PD-27) — в теле
 * запроса `key`, в ответе создания/перевыпуска `key`, на один уровень вложенности в любых объектах. Дополнительно
 * ключ не логируем сами: в записях recovery-роутера только `groupId` и `keyHmacPrefix`.
 */
export const REDACT_PATHS = [
  "authorization",
  "req.headers.authorization",
  "headers.authorization",
  "*.headers.authorization",
  "key",
  "*.key",
  "req.body.key",
  "body.key",
  "res.body.key",
];

/** `destination` — только для тестов (поток вместо stdout, без pino-pretty). */
export function createLogger(level: string = env.logLevel, destination?: pino.DestinationStream): Logger {
  const options: pino.LoggerOptions = { level, redact: { paths: REDACT_PATHS, censor: "[redacted]" } };
  if (destination) return pino(options, destination);
  return pino({
    ...options,
    ...(env.nodeEnv === "development" && level !== "silent"
      ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
      : {}),
  });
}
