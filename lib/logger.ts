import pino, { type Logger } from "pino";

export type LogFormat = "json" | "text";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// TextLogger implements pino's Logger interface for text output
// without JSON serialization overhead.
class TextLogger {
  private levelValue: number;

  constructor(public level: LogLevel) {
    this.levelValue = LOG_LEVELS[level];
  }

  private log(levelName: string, levelValue: number, obj: unknown, msg?: string): void {
    if (levelValue < this.levelValue) return;

    const parts: string[] = [formatTimestamp(Date.now()), levelName.toUpperCase()];

    // Handle pino's multiple calling conventions:
    // log(msg), log(obj), log(obj, msg)
    let mergeObj: Record<string, unknown> | undefined;
    let message: string | undefined;

    if (typeof obj === "string") {
      message = obj;
    } else if (typeof obj === "object" && obj !== null) {
      mergeObj = obj as Record<string, unknown>;
      message = msg;
    }

    if (message !== undefined) {
      parts.push(message);
    }

    if (mergeObj) {
      for (const [key, value] of Object.entries(mergeObj)) {
        if (key === "msg") continue;
        parts.push(`${key}=${formatValue(value)}`);
      }
    }

    process.stdout.write(parts.join(" ") + "\n");
  }

  trace(obj: unknown, msg?: string): void {
    this.log("trace", LOG_LEVELS.trace, obj, msg);
  }

  debug(obj: unknown, msg?: string): void {
    this.log("debug", LOG_LEVELS.debug, obj, msg);
  }

  info(obj: unknown, msg?: string): void {
    this.log("info", LOG_LEVELS.info, obj, msg);
  }

  warn(obj: unknown, msg?: string): void {
    this.log("warn", LOG_LEVELS.warn, obj, msg);
  }

  error(obj: unknown, msg?: string): void {
    this.log("error", LOG_LEVELS.error, obj, msg);
  }

  fatal(obj: unknown, msg?: string): void {
    this.log("fatal", LOG_LEVELS.fatal, obj, msg);
  }

  silent(): void {}

  isLevelEnabled(level: string): boolean {
    const levelValue = LOG_LEVELS[level as LogLevel] ?? 0;
    return levelValue >= this.levelValue;
  }

  child(bindings: Record<string, unknown>): Logger {
    const child = new TextLogger(this.level);
    const parentLog = child.log.bind(child);
    child.log = (levelName: string, levelValue: number, obj: unknown, msg?: string) => {
      const merged =
        typeof obj === "object" && obj !== null
          ? { ...bindings, ...obj }
          : { ...bindings };
      parentLog(levelName, levelValue, merged, typeof obj === "string" ? obj : msg);
    };
    return child as unknown as Logger;
  }
}

export function createLogger(format: LogFormat, level: LogLevel): Logger {
  if (format === "text") {
    return new TextLogger(level) as unknown as Logger;
  }

  return pino({
    level,
    base: undefined,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

// Formats timestamp in Go's default format: 2006/01/02 15:04:05
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    // Quote strings that contain spaces or special characters
    if (value.includes(" ") || value.includes("=") || value.includes('"')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// Default logger for use before CLI parsing (e.g., in cli.ts for validation errors)
export const logger = new TextLogger("info") as unknown as Logger;
