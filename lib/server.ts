import type { Logger } from "pino";

import { RUNTIME_VERSION, VERSION } from "./cli.ts";
import type { Client } from "./fetch.ts";
import { ImageEngine } from "./image.ts";
import type { PipelineExecutor } from "./pipeline.ts";
import {
  HttpError,
  ImageFit,
  ImageKernel,
  ImagePosition,
  type ImagePreset,
  type PipelineConfig,
  ImageType,
} from "./types.ts";
import {
  addWarning,
  getMimetype,
  IMAGE_TYPE_SET,
  normalizeFormat,
  parseBlurLenient,
  parseBooleanLenient,
  parseDimensionLenient,
  parseEffortLenient,
  parseFitLenient,
  parseKernelLenient,
  type ParseContext,
  parsePositionLenient,
  parsePresetLenient,
  parseQualityLenient,
  VALID_FORMATS,
} from "./validation.ts";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import multipart from "@fastify/multipart";

export interface ServeOptions {
  port: number;
  host?: string;
  unix?: string;
  enableFetch: boolean;
  tlsCert?: string;
  tlsKey?: string;
  mtlsCa?: string;
  pipelineExecutor?: PipelineExecutor;
}

export class Server {
  private client: Client;
  private engine: ImageEngine;
  private bodyLimit: number;
  private dimensionLimit: number;
  private logger: Logger;

  constructor(
    client: Client,
    engine: ImageEngine,
    bodyLimitBytes: number,
    dimensionLimit: number,
    logger: Logger,
  ) {
    this.client = client;
    this.engine = engine;
    this.bodyLimit = bodyLimitBytes;
    this.dimensionLimit = dimensionLimit;
    this.logger = logger;
  }

  async serve(options: ServeOptions): Promise<string> {
    if (options.unix) {
      await ensureUnixSocketReady(options.unix);
    }

    const server = Fastify({
      bodyLimit: this.bodyLimit,
      keepAliveTimeout: 10_000,
      ...(options.tlsCert &&
        options.tlsKey && {
          https: {
            cert: fs.readFileSync(options.tlsCert),
            key: fs.readFileSync(options.tlsKey),
            ...(options.mtlsCa && {
              ca: fs.readFileSync(options.mtlsCa),
              requestCert: true,
              rejectUnauthorized: true,
            }),
          },
        }),
    });
    server.setErrorHandler(errorHandler);
    server.setNotFoundHandler(notFoundHandler);
    registerSignals(server, this.logger, options.unix);

    // Request/response logging middleware (only if debug is enabled)
    if (this.logger.isLevelEnabled("debug")) {
      const logger = this.logger;
      server.addHook("onResponse", (request, reply, done) => {
        logger.debug(
          {
            method: request.method,
            path: request.url,
            status: reply.statusCode,
            duration: Math.round(reply.elapsedTime),
          },
          "request",
        );
        done();
      });
    }

    server.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_, body, done) => {
        done(null, body);
      },
    );
    server.addContentTypeParser("*", { parseAs: "buffer" }, (_, body, done) => {
      done(null, body);
    });

    // Register multipart plugin if pipeline is enabled
    if (options.pipelineExecutor) {
      await server.register(multipart, {
        limits: {
          fileSize: this.bodyLimit,
        },
      });
    }

    server.get("/healthz", this.healthz);
    server.put("/transform", this.transformPut);
    server.put("/metadata", this.metadataPut);

    if (options.enableFetch) {
      server.get("/transform", this.transformGet);
      server.get("/metadata", this.metadataGet);
    }

    // Register pipeline endpoint if enabled
    if (options.pipelineExecutor) {
      const pipelineExecutor = options.pipelineExecutor;
      server.put("/pipeline", async (request: FastifyRequest, reply: FastifyReply) => {
        await this.handlePipeline(request, reply, pipelineExecutor);
      });
    }

    return await server.listen({
      host: options.host,
      port: options.unix ? undefined : options.port,
      path: options.unix,
    });
  }

  private transformGet = async (request: FastifyRequest, reply: FastifyReply) => {
    const start = performance.now();
    const params = request.query as QueryParams;

    const url = params["url"];
    if (!url) {
      throw new HttpError(400, "missing 'url' query parameter");
    }

    const acceptHeader = request.headers["accept"];
    const accept = Array.isArray(acceptHeader)
      ? acceptHeader.join(",")
      : (acceptHeader ?? "");

    const { options: ops, ctx } = parseImageOps(params, accept, this.dimensionLimit);
    if (!this.engine.encoders.includes(ops.format)) {
      throw new HttpError(400, `image: encoding type ${ops.format} is not supported`);
    }

    const data = await this.client.fetch(url);
    await this.performTransform(reply, data, ops, ctx, start);
  };

  private transformPut = async (request: FastifyRequest, reply: FastifyReply) => {
    const start = performance.now();
    const params = request.query as QueryParams;

    const acceptHeader = request.headers["accept"];
    const accept = Array.isArray(acceptHeader)
      ? acceptHeader.join(",")
      : (acceptHeader ?? "");

    const { options: ops, ctx } = parseImageOps(params, accept, this.dimensionLimit);
    if (!this.engine.encoders.includes(ops.format)) {
      throw new HttpError(400, `image: encoding type ${ops.format} is not supported`);
    }

    if (!Buffer.isBuffer(request.body)) {
      throw new HttpError(400, "image data must be provided in the request body");
    }

    await this.performTransform(reply, request.body, ops, ctx, start);
  };

  private performTransform = async (
    reply: FastifyReply,
    data: Uint8Array,
    ops: Options,
    ctx: ParseContext,
    start: number,
  ) => {
    const img = await this.engine.perform({
      data,
      format: ops.format,
      width: ops.width,
      height: ops.height,
      quality: ops.quality,
      blur: ops.blur,
      greyscale: ops.greyscale,
      lossless: ops.lossless,
      progressive: ops.progressive,
      effort: ops.effort,
      fit: ops.fit,
      kernel: ops.kernel,
      position: ops.position,
      preset: ops.preset,
    });

    const elapsed = Math.round(performance.now() - start);
    setWarningsHeader(reply, ctx);
    reply
      .header("content-type", getMimetype(img.format))
      .header("x-image-width", String(img.width))
      .header("x-image-height", String(img.height))
      .header("x-response-time-ms", String(elapsed));
    return reply.send(img.data);
  };

  private metadataGet = async (request: FastifyRequest, reply: FastifyReply) => {
    const start = performance.now();
    const params = (request.query as QueryParams) || {};

    const url = params["url"];
    if (!url) {
      throw new HttpError(400, "missing 'url' query parameter");
    }

    const metaOps = parseMetadataOps(params);
    const data = await this.client.fetch(url);

    await this.metadata(reply, data, metaOps, start);
  };

  private metadataPut = async (request: FastifyRequest, reply: FastifyReply) => {
    const start = performance.now();
    const params = (request.query as QueryParams) || {};

    if (!Buffer.isBuffer(request.body)) {
      throw new HttpError(400, "image data must be provided in the request body");
    }

    const metaOps = parseMetadataOps(params);
    await this.metadata(reply, request.body, metaOps, start);
  };

  private metadata = async (
    reply: FastifyReply,
    data: Uint8Array,
    metaOps: MetadataParseResult,
    start: number,
  ) => {
    const res = await this.engine.metadata({
      data,
      exif: metaOps.exif,
      stats: metaOps.stats,
      thumbhash: metaOps.thumbhash,
    });

    const elapsed = Math.round(performance.now() - start);
    setWarningsHeader(reply, metaOps.ctx);
    reply.header("x-response-time-ms", String(elapsed));
    return reply.send(res);
  };

  private healthz = async (_: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      version: VERSION,
      runtime: RUNTIME_VERSION,
      sharp: ImageEngine.VERSIONS.sharp,
      vips: ImageEngine.VERSIONS.vips,
      decoders: this.engine.decoders,
      encoders: this.engine.encoders,
    });
  };

  private handlePipeline = async (
    request: FastifyRequest,
    reply: FastifyReply,
    executor: PipelineExecutor,
  ) => {
    const contentType = request.headers["content-type"] || "";

    let config: PipelineConfig;
    let imageData: Uint8Array | undefined;

    if (contentType.includes("multipart/form-data")) {
      // Handle multipart request
      const parts = request.parts();
      let configPart: string | undefined;
      let filePart: Buffer | undefined;

      for await (const part of parts) {
        if (part.type === "field" && part.fieldname === "config") {
          configPart = part.value as string;
        } else if (part.type === "file" && part.fieldname === "file") {
          filePart = await part.toBuffer();
        }
      }

      if (!configPart) {
        throw new HttpError(400, "missing 'config' part in multipart request");
      }

      try {
        config = JSON.parse(configPart) as PipelineConfig;
      } catch {
        throw new HttpError(400, "invalid JSON in 'config' part");
      }

      if (!filePart) {
        throw new HttpError(400, "missing 'file' part in multipart request");
      }
      imageData = filePart;
    } else if (contentType.includes("application/json")) {
      // Handle JSON request
      if (!Buffer.isBuffer(request.body)) {
        throw new HttpError(400, "request body must be JSON");
      }

      try {
        config = JSON.parse(request.body.toString()) as PipelineConfig;
      } catch {
        throw new HttpError(400, "invalid JSON in request body");
      }
    } else {
      throw new HttpError(
        400,
        "Content-Type must be application/json or multipart/form-data",
      );
    }

    const result = await executor.execute(config, imageData);
    return reply.send(result);
  };
}

interface Options {
  format: ImageType;
  width?: number;
  height?: number;
  quality?: number;
  blur?: boolean | number;
  greyscale?: boolean;
  lossless?: boolean;
  progressive?: boolean;
  effort?: number;
  fit?: ImageFit;
  kernel?: ImageKernel;
  position?: ImagePosition;
  preset?: ImagePreset;
}

// ParseContext is imported from validation.ts

interface ParseResult {
  options: Options;
  ctx: ParseContext;
}

interface MetadataParseResult {
  exif: boolean;
  stats: boolean;
  thumbhash: boolean;
  ctx: ParseContext;
}

function createParseContext(params: QueryParams, dimensionLimit: number): ParseContext {
  const ctx: ParseContext = { strict: false, warnings: [], dimensionLimit };
  const strict = parseBooleanLenient(params["strict"], "strict", ctx);
  ctx.strict = (ctx.warnings.length === 0 && strict) || false;
  return ctx;
}

// For /transform endpoint (plain text error)
function throwIfErrorsText(ctx: ParseContext): void {
  if (ctx.strict && ctx.warnings.length > 0) {
    const messages = ctx.warnings.map(
      (e) => `${e.param}: ${e.reason} (got "${e.value}")`,
    );
    throw new HttpError(400, `Invalid parameters:\n- ${messages.join("\n- ")}`);
  }
}

// For /metadata endpoint (JSON error)
function throwIfErrorsJson(ctx: ParseContext): void {
  if (ctx.strict && ctx.warnings.length > 0) {
    const body = JSON.stringify({
      error: "Invalid parameters",
      details: ctx.warnings.map((w) => ({
        param: w.param,
        value: w.value,
        reason: w.reason,
      })),
    });
    throw new HttpError(400, body);
  }
}

// Set warnings header on successful response (lenient mode)
function setWarningsHeader(reply: FastifyReply, ctx: ParseContext): void {
  if (!ctx.strict && ctx.warnings.length > 0) {
    const header = ctx.warnings.map((w) => `${w.param}: ${w.reason}`).join("; ");
    reply.header("X-Imaged-Warnings", header);
  }
}

// Known parameter sets for unknown param detection
const KNOWN_TRANSFORM_PARAMS = new Set([
  "url",
  "format",
  "width",
  "height",
  "quality",
  "effort",
  "blur",
  "greyscale",
  "lossless",
  "progressive",
  "fit",
  "kernel",
  "position",
  "preset",
  "strict",
]);

const KNOWN_METADATA_PARAMS = new Set(["url", "exif", "stats", "thumbhash", "strict"]);

function validateKnownParams(
  params: QueryParams,
  known: Set<string>,
  ctx: ParseContext,
): void {
  for (const key of Object.keys(params)) {
    if (!known.has(key)) {
      addWarning(ctx, key, params[key] ?? "", "unknown parameter");
    }
  }
}

function parseImageOps(
  params: QueryParams,
  accept: string,
  dimensionLimit: number,
): ParseResult {
  const ctx = createParseContext(params, dimensionLimit);

  // Validate unknown params
  validateKnownParams(params, KNOWN_TRANSFORM_PARAMS, ctx);

  const format = parseFormat(params, accept, ctx);
  const options: Options = {
    format,
    width: parseDimensionLenient(params["width"], "width", ctx),
    height: parseDimensionLenient(params["height"], "height", ctx),
    quality: parseQualityLenient(params["quality"], ctx),
    blur: parseBlurLenient(params["blur"], ctx),
    greyscale: parseBooleanLenient(params["greyscale"], "greyscale", ctx),
    lossless: parseBooleanLenient(params["lossless"], "lossless", ctx),
    progressive: parseBooleanLenient(params["progressive"], "progressive", ctx),
    effort: parseEffortLenient(params["effort"], format, ctx),
    fit: parseFitLenient(params["fit"], ctx),
    kernel: parseKernelLenient(params["kernel"], ctx),
    position: parsePositionLenient(params["position"], ctx),
    preset: parsePresetLenient(params["preset"], ctx),
  };

  throwIfErrorsText(ctx);
  return { options, ctx };
}

function parseMetadataOps(params: QueryParams): MetadataParseResult {
  const ctx = createParseContext(params, 0);

  // Validate unknown params
  validateKnownParams(params, KNOWN_METADATA_PARAMS, ctx);

  const result: MetadataParseResult = {
    exif: parseBooleanLenient(params["exif"], "exif", ctx) ?? false,
    stats: parseBooleanLenient(params["stats"], "stats", ctx) ?? false,
    thumbhash: parseBooleanLenient(params["thumbhash"], "thumbhash", ctx) ?? false,
    ctx,
  };

  throwIfErrorsJson(ctx);
  return result;
}

const DEFAULT_FORMAT = ImageType.Jpeg;

function parseFormat(
  params: QueryParams,
  accept: string,
  ctx: ParseContext,
): ImageType {
  const v = params["format"];
  if (v == null || v === "") {
    return DEFAULT_FORMAT;
  }

  const opts = v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");

  // If no options, return the default.
  if (opts.length === 0) {
    return DEFAULT_FORMAT;
  }

  // If only one option, return it (or the default).
  if (opts.length === 1) {
    const first = opts[0];
    if (!first) {
      return DEFAULT_FORMAT;
    }
    const t = getImageType(first);
    if (t == null) {
      addWarning(ctx, "format", first, `unknown format, valid: ${VALID_FORMATS}`);
      return DEFAULT_FORMAT;
    }
    return t;
  }

  // Track invalid formats for warnings
  const invalidFormats: string[] = [];

  // Try to pick first option that matches the Accept header.
  const acceptLower = accept.toLowerCase();
  for (const opt of opts) {
    const t = getImageType(opt);
    if (t == null) {
      invalidFormats.push(opt);
      continue;
    }
    if (acceptLower.includes(getMimetype(t))) {
      // Add warnings for any invalid formats we encountered
      for (const invalid of invalidFormats) {
        addWarning(ctx, "format", invalid, `unknown format, valid: ${VALID_FORMATS}`);
      }
      return t;
    }
  }

  // Fallback to the last option (or the default).
  const opt = opts[opts.length - 1];
  if (!opt) {
    return DEFAULT_FORMAT;
  }
  const t = getImageType(opt);
  if (t == null) {
    addWarning(ctx, "format", opt, `unknown format, valid: ${VALID_FORMATS}`);
    return DEFAULT_FORMAT;
  }

  // Add warnings for any invalid formats we encountered
  for (const invalid of invalidFormats) {
    addWarning(ctx, "format", invalid, `unknown format, valid: ${VALID_FORMATS}`);
  }
  return t;
}

function getImageType(raw: string): ImageType | null {
  const normalized = normalizeFormat(raw);
  if (!IMAGE_TYPE_SET.has(normalized)) {
    return null;
  }
  return normalized as ImageType;
}

type QueryParams = Record<string, string | undefined>;

// Export for testing and reuse
export { createParseContext, parseImageOps, parseMetadataOps };

function notFoundHandler(_req: FastifyRequest, reply: FastifyReply) {
  reply.code(404);
  return reply.send("404 Not Found");
}

function errorHandler(err: unknown, _req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    reply.code(err.code);
    return reply.send(err.body);
  }

  reply.code(500);
  return reply.send("500 Internal server error");
}

async function ensureUnixSocketReady(socketPath: string) {
  const dir = path.dirname(socketPath);
  await fsp.mkdir(dir, { recursive: true });

  // If something already exists at the path:
  // - If it's a socket, remove it (stale from a crash)
  // - Otherwise, refuse (avoid clobbering a real file)
  try {
    const st = await fsp.lstat(socketPath);
    if (!st.isSocket()) {
      throw new Error(
        `Refusing to overwrite existing non-socket at UNIX path: ${socketPath}`,
      );
    }
    await fsp.unlink(socketPath);
  } catch (err) {
    // ENOENT means the socket doesn't exist, which is fine
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }
}

function registerSignals(
  server: FastifyInstance,
  logger: Logger,
  unixSocketPath?: string,
) {
  const cleanupSocket = () => {
    if (!unixSocketPath) return;
    try {
      const st = fs.lstatSync(unixSocketPath);
      if (st.isSocket()) fs.unlinkSync(unixSocketPath);
    } catch {
      // Socket doesn't exist or can't be removed - ignore
    }
  };

  // Ensure socket cleanup on unexpected exit
  process.on("exit", cleanupSocket);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");

    const forceExit = setTimeout(() => {
      logger.warn("Timeout reached, forcing exit");
      cleanupSocket();
      process.exit(1);
    }, 10_000);

    try {
      await server.close();
      clearTimeout(forceExit);
      cleanupSocket();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error shutting down");
      cleanupSocket();
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
