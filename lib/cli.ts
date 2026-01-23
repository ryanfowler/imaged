import pkg from "../package.json" with { type: "json" };
import { logger, type LogFormat, type LogLevel } from "./logger.ts";

import fs from "node:fs";

import { Command } from "commander";

export interface CLIOptions {
  port: number;
  host?: string;
  unix?: string;
  concurrency: number;
  bodyLimit: number;
  pixelLimit: number;
  dimensionLimit: number;
  enableFetch: boolean;
  allowedHosts?: RegExp;
  logFormat: LogFormat;
  logLevel: LogLevel;
  tlsCert?: string;
  tlsKey?: string;
}

interface RawOptions {
  port: string;
  host?: string;
  unix?: string;
  concurrency: string;
  bodyLimit: string;
  pixelLimit: string;
  dimensionLimit: string;
  enableFetch: boolean;
  allowedHosts?: string;
  logFormat: string;
  logLevel: string;
  tlsCert?: string;
  tlsKey?: string;
}

export function parseArgs(): CLIOptions {
  const defaultConcurrency = Math.ceil(navigator.hardwareConcurrency);

  const program = new Command()
    .name("imaged")
    .description("Image processing server")
    .option("-a, --allowed-hosts <regex>", "Regex pattern for allowed fetch hosts")
    .option(
      "-b, --body-limit <bytes>",
      "Max request body size in bytes",
      String(1 << 24),
    )
    .option(
      "-c, --concurrency <number>",
      "Max concurrent image operations",
      String(defaultConcurrency),
    )
    .option("-f, --enable-fetch", "Enable GET endpoints that fetch remote URLs", false)
    .helpOption("-h --help", "Display help")
    .option("-H, --host <address>", "HTTP host to bind to")
    .option("-l, --log-format <format>", "Log format: json or text", "text")
    .option("-L, --log-level <level>", "Log level: debug, info, warn, or error", "info")
    .option("-x, --pixel-limit <pixels>", "Max input image pixels", String(100_000_000))
    .option(
      "-d, --dimension-limit <pixels>",
      "Max output width/height in pixels",
      String(16384),
    )
    .option("-p, --port <number>", "HTTP port to listen on", "8000")
    .option("--tls-cert <path>", "Path to TLS certificate file")
    .option("--tls-key <path>", "Path to TLS private key file")
    .option("-u, --unix <path>", "Unix socket path (overrides port/host)")
    .version(VERSION, undefined, "Output the version")
    .parse();

  const opts = program.opts<RawOptions>();

  const port = parseInt(opts.port, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    logger.fatal({ value: opts.port }, "Invalid port");
    process.exit(1);
  }

  const concurrency = parseInt(opts.concurrency, 10);
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    logger.fatal({ value: opts.concurrency }, "Invalid concurrency");
    process.exit(1);
  }

  const bodyLimit = parseInt(opts.bodyLimit, 10);
  if (!Number.isInteger(bodyLimit) || bodyLimit <= 0) {
    logger.fatal({ value: opts.bodyLimit }, "Invalid body limit");
    process.exit(1);
  }

  const pixelLimit = parseInt(opts.pixelLimit, 10);
  if (!Number.isInteger(pixelLimit) || pixelLimit <= 0) {
    logger.fatal({ value: opts.pixelLimit }, "Invalid pixel limit");
    process.exit(1);
  }

  const dimensionLimit = parseInt(opts.dimensionLimit, 10);
  if (!Number.isInteger(dimensionLimit) || dimensionLimit <= 0) {
    logger.fatal({ value: opts.dimensionLimit }, "Invalid dimension limit");
    process.exit(1);
  }

  let allowedHosts: RegExp | undefined;
  if (opts.allowedHosts) {
    try {
      allowedHosts = new RegExp(opts.allowedHosts);
    } catch {
      logger.fatal({ value: opts.allowedHosts }, "Invalid allowed-hosts regex");
      process.exit(1);
    }
  }

  const logFormat = opts.logFormat;
  if (logFormat !== "json" && logFormat !== "text") {
    logger.fatal({ value: logFormat }, "Invalid log format (must be 'json' or 'text')");
    process.exit(1);
  }

  const logLevel = opts.logLevel;
  if (
    logLevel !== "debug" &&
    logLevel !== "info" &&
    logLevel !== "warn" &&
    logLevel !== "error"
  ) {
    logger.fatal(
      { value: logLevel },
      "Invalid log level (must be 'debug', 'info', 'warn', or 'error')",
    );
    process.exit(1);
  }

  const tlsCert = opts.tlsCert;
  const tlsKey = opts.tlsKey;
  if ((tlsCert && !tlsKey) || (!tlsCert && tlsKey)) {
    logger.fatal("Both --tls-cert and --tls-key must be provided for TLS");
    process.exit(1);
  }
  if (tlsCert && tlsKey) {
    if (!fs.existsSync(tlsCert)) {
      logger.fatal({ path: tlsCert }, "TLS certificate file not found");
      process.exit(1);
    }
    if (!fs.existsSync(tlsKey)) {
      logger.fatal({ path: tlsKey }, "TLS key file not found");
      process.exit(1);
    }
  }

  return {
    port,
    host: opts.host,
    unix: opts.unix,
    concurrency,
    bodyLimit,
    pixelLimit,
    dimensionLimit,
    enableFetch: opts.enableFetch,
    allowedHosts,
    logFormat,
    logLevel,
    tlsCert,
    tlsKey,
  };
}

export const RUNTIME_VERSION = getRuntimeVersion();

function getRuntimeVersion() {
  if (process.versions["bun"]) {
    return `Bun ${process.versions["bun"]}`;
  }
  return `Node.js ${process.version}`;
}

export const VERSION = pkg.version;
