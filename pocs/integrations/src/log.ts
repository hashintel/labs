import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type Logger = pino.Logger;

export function createLogger(name: string, level: LogLevel = "info"): Logger {
  return pino({ name, level, transport: { target: "pino-pretty", options: { colorize: true } } });
}
