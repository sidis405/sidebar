// stderr logger per the spec's Runtime baseline: INFO by default, --verbose
// raises to DEBUG, --quiet lowers to WARN. No file logging in V1.

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const RANK: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

let threshold: number = RANK.INFO;

export function setLogLevel(level: LogLevel): void {
  threshold = RANK[level];
}

function emit(level: LogLevel, msg: string): void {
  if (RANK[level] < threshold) return;
  process.stderr.write(`[${level}] ${msg}\n`);
}

export const log = {
  debug: (m: string) => emit("DEBUG", m),
  info: (m: string) => emit("INFO", m),
  warn: (m: string) => emit("WARN", m),
  error: (m: string) => emit("ERROR", m),
};
