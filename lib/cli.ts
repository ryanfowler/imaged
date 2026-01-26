import pkg from "../package.json" with { type: "json" };
import { logger, type LogFormat, type LogLevel } from "./logger.ts";
import { parseS3Config } from "./s3.ts";
import type { S3Config } from "./types.ts";

import fs from "node:fs";

import { Command, Option } from "commander";

/**
 * Parse boolean string values from environment variables or CLI arguments.
 * Accepts "true", "1" as true; "false", "0" as false.
 */
export function parseBool(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1") {
    return true;
  }
  if (lower === "false" || lower === "0") {
    return false;
  }
  // For invalid values, treat as truthy (flag was specified)
  return true;
}

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
  ssrfProtection: boolean;
  logFormat: LogFormat;
  logLevel: LogLevel;
  tlsCert?: string;
  tlsKey?: string;
  mtlsCa?: string;
  enablePipeline: boolean;
  maxPipelineTasks: number;
  s3Config?: S3Config;
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
  disableSsrfProtection: boolean;
  logFormat: string;
  logLevel: string;
  tlsCert?: string;
  tlsKey?: string;
  mtlsCa?: string;
  enablePipeline: boolean;
  maxPipelineTasks: string;
}

export function parseArgs(): CLIOptions {
  const defaultConcurrency = Math.ceil(navigator.hardwareConcurrency);

  const program = new Command()
    .name("imaged")
    .description("Image processing server")
    .configureHelp({
      optionTerm: (option) => {
        // Add padding for flags without short form to align with "-X, " prefix
        if (option.flags.startsWith("--")) {
          return "    " + option.flags;
        }
        return option.flags;
      },
    })
    .addOption(
      new Option(
        "-a, --allowed-hosts <regex>",
        "Regex pattern for allowed fetch hosts",
      ).env("ALLOWED_HOSTS"),
    )
    .addOption(
      new Option("-b, --body-limit <bytes>", "Max request body size in bytes")
        .default(String(1 << 24))
        .env("BODY_LIMIT"),
    )
    .addOption(
      new Option("-c, --concurrency <number>", "Max concurrent image operations")
        .default(String(defaultConcurrency))
        .env("CONCURRENCY"),
    )
    .addOption(
      new Option(
        "-f, --enable-fetch [bool]",
        "Enable GET endpoints that fetch remote URLs",
      )
        .preset("true")
        .default(false)
        .argParser(parseBool)
        .env("ENABLE_FETCH"),
    )
    .helpOption("-h --help", "Display help")
    .addOption(
      new Option(
        "--disable-ssrf-protection [bool]",
        "Disable SSRF protection (allow requests to private IPs)",
      )
        .preset("true")
        .default(false)
        .argParser(parseBool)
        .env("DISABLE_SSRF_PROTECTION"),
    )
    .addOption(new Option("-H, --host <address>", "HTTP host to bind to").env("HOST"))
    .addOption(
      new Option("-l, --log-format <format>", "Log format: json or text")
        .default("text")
        .env("LOG_FORMAT"),
    )
    .addOption(
      new Option("-L, --log-level <level>", "Log level: debug, info, warn, or error")
        .default("info")
        .env("LOG_LEVEL"),
    )
    .addOption(
      new Option("-x, --pixel-limit <pixels>", "Max input image pixels")
        .default(String(100_000_000))
        .env("PIXEL_LIMIT"),
    )
    .addOption(
      new Option("-d, --dimension-limit <pixels>", "Max output width/height in pixels")
        .default(String(16384))
        .env("DIMENSION_LIMIT"),
    )
    .addOption(
      new Option("-p, --port <number>", "HTTP port to listen on")
        .default("8000")
        .env("PORT"),
    )
    .addOption(
      new Option("--tls-cert <path>", "Path to TLS certificate file").env("TLS_CERT"),
    )
    .addOption(
      new Option("--tls-key <path>", "Path to TLS private key file").env("TLS_KEY"),
    )
    .addOption(
      new Option(
        "--mtls-ca <path>",
        "Path to CA certificate for client verification (enables mTLS)",
      ).env("MTLS_CA"),
    )
    .addOption(
      new Option("-u, --unix <path>", "Unix socket path (overrides port/host)").env(
        "UNIX_SOCKET",
      ),
    )
    .addOption(
      new Option(
        "-P, --enable-pipeline [bool]",
        "Enable the /pipeline endpoint (Bun only)",
      )
        .preset("true")
        .default(false)
        .argParser(parseBool)
        .env("ENABLE_PIPELINE"),
    )
    .addOption(
      new Option("--max-pipeline-tasks <number>", "Maximum tasks per pipeline request")
        .default("10")
        .env("MAX_PIPELINE_TASKS"),
    )
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

  const mtlsCa = opts.mtlsCa;
  if (mtlsCa) {
    if (!fs.existsSync(mtlsCa)) {
      logger.fatal({ path: mtlsCa }, "mTLS CA certificate file not found");
      process.exit(1);
    }
    if (!tlsCert || !tlsKey) {
      logger.fatal("--mtls-ca requires TLS to be enabled (--tls-cert and --tls-key)");
      process.exit(1);
    }
  }

  const maxPipelineTasks = parseInt(opts.maxPipelineTasks, 10);
  if (!Number.isInteger(maxPipelineTasks) || maxPipelineTasks <= 0) {
    logger.fatal({ value: opts.maxPipelineTasks }, "Invalid max-pipeline-tasks");
    process.exit(1);
  }

  // Validate pipeline configuration
  let s3Config: S3Config | undefined;
  if (opts.enablePipeline) {
    // Check if running on Bun
    if (!process.versions["bun"]) {
      logger.fatal("Pipeline endpoint requires Bun runtime");
      process.exit(1);
    }

    // Validate S3 credentials
    s3Config = parseS3Config() ?? undefined;
    if (!s3Config) {
      logger.fatal(
        "Pipeline endpoint requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables",
      );
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
    ssrfProtection: !opts.disableSsrfProtection,
    logFormat,
    logLevel,
    tlsCert,
    tlsKey,
    mtlsCa,
    enablePipeline: opts.enablePipeline,
    maxPipelineTasks,
    s3Config,
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
