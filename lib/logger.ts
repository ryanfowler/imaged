import pino, { type Logger } from "pino";

export type LogFormat = "json" | "text";
export type LogLevel = "debug" | "info" | "warn" | "error";

export function createLogger(format: LogFormat, level: LogLevel): Logger {
  if (format === "text") {
    return pino(
      {
        level,
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
      {
        write(msg: string) {
          const obj = JSON.parse(msg);
          process.stdout.write(formatLogLine(obj) + "\n");
        },
      },
    );
  }

  return pino({
    level,
    base: undefined,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

// Formats log lines in Go slog TextHandler style:
// 2006/01/02 15:04:05 INFO message key=value ...
function formatLogLine(obj: Record<string, unknown>): string {
  const parts: string[] = [];

  // slog format: timestamp level message key=value...
  if (obj["time"] !== undefined) {
    parts.push(formatTimestamp(obj["time"] as number));
  }
  if (obj["level"] !== undefined) {
    parts.push(levelToSlog(obj["level"] as string));
  }
  if (obj["msg"] !== undefined) {
    parts.push(String(obj["msg"]));
  }

  // Add remaining fields as key=value pairs
  for (const [key, value] of Object.entries(obj)) {
    if (
      key === "level" ||
      key === "time" ||
      key === "msg" ||
      key === "pid" ||
      key === "hostname"
    ) {
      continue;
    }
    parts.push(`${key}=${formatValue(value)}`);
  }

  return parts.join(" ");
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

// Maps pino log levels to Go slog level names
function levelToSlog(level: string): string {
  switch (level) {
    case "trace":
      return "TRACE";
    case "debug":
      return "DEBUG";
    case "info":
      return "INFO";
    case "warn":
      return "WARN";
    case "error":
      return "ERROR";
    case "fatal":
      return "FATAL";
    default:
      return level.toUpperCase();
  }
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
export const logger = pino(
  {
    level: "info",
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  {
    write(msg: string) {
      const obj = JSON.parse(msg);
      process.stdout.write(formatLogLine(obj) + "\n");
    },
  },
);
