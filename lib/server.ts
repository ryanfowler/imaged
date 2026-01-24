import type { Logger } from "pino";

import { RUNTIME_VERSION, VERSION } from "./cli.ts";
import type { Client } from "./fetch.ts";
import { ImageEngine } from "./image.ts";
import {
  HttpError,
  IMAGE_PRESETS,
  ImageFit,
  ImageKernel,
  ImagePosition,
  type ImagePreset,
  ImageType,
} from "./types.ts";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

export interface ServeOptions {
  port: number;
  host?: string;
  unix?: string;
  enableFetch: boolean;
  tlsCert?: string;
  tlsKey?: string;
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

    server.addContentTypeParser("*", { parseAs: "buffer" }, (_, body, done) => {
      done(null, body);
    });

    server.get("/healthz", this.healthz);
    server.put("/transform", this.transformPut);
    server.put("/metadata", this.metadataPut);

    if (options.enableFetch) {
      server.get("/transform", this.transformGet);
      server.get("/metadata", this.metadataGet);
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

// Parse context for strict mode validation
interface ParseWarning {
  param: string;
  value: string;
  reason: string;
}

interface ParseContext {
  strict: boolean;
  warnings: ParseWarning[];
  dimensionLimit: number;
}

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
  const ctx = { strict: false, warnings: [], dimensionLimit };
  const strict = parseBoolean(params, "strict", ctx);
  ctx.strict = (ctx.warnings.length === 0 && strict) || false;
  return ctx;
}

function addWarning(
  ctx: ParseContext,
  param: string,
  value: string,
  reason: string,
): void {
  ctx.warnings.push({ param, value, reason });
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
    width: parseDimension(params, "width", ctx),
    height: parseDimension(params, "height", ctx),
    quality: parseQuality(params, ctx),
    blur: parseBlur(params, ctx),
    greyscale: parseBoolean(params, "greyscale", ctx),
    lossless: parseBoolean(params, "lossless", ctx),
    progressive: parseBoolean(params, "progressive", ctx),
    effort: parseEffort(params, format, ctx),
    fit: parseImageFit(params, ctx),
    kernel: parseImageKernel(params, ctx),
    position: parseImagePosition(params, ctx),
    preset: parseImagePreset(params, ctx),
  };

  throwIfErrorsText(ctx);
  return { options, ctx };
}

function parseMetadataOps(params: QueryParams): MetadataParseResult {
  const ctx = createParseContext(params, 0);

  // Validate unknown params
  validateKnownParams(params, KNOWN_METADATA_PARAMS, ctx);

  const result: MetadataParseResult = {
    exif: parseBoolean(params, "exif", ctx) ?? false,
    stats: parseBoolean(params, "stats", ctx) ?? false,
    thumbhash: parseBoolean(params, "thumbhash", ctx) ?? false,
    ctx,
  };

  throwIfErrorsJson(ctx);
  return result;
}

const DEFAULT_FORMAT = ImageType.Jpeg;
const VALID_FORMATS = Object.values(ImageType).join(", ");

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

function parseBoolean(
  params: QueryParams,
  key: string,
  ctx: ParseContext,
): boolean | undefined {
  const v = params[key];
  if (v == null) {
    return undefined;
  }
  if (v === "false" || v === "0") {
    return false;
  }
  if (v === "" || v === "true" || v === "1") {
    return true;
  }
  // Invalid value - warn and treat as true
  addWarning(ctx, key, v, "must be true, false, 1, or 0");
  return true;
}

function parseBlur(
  params: QueryParams,
  ctx: ParseContext,
): boolean | number | undefined {
  const v = params["blur"];
  if (v == null) {
    return undefined;
  }
  if (v === "false" || v === "0") {
    return undefined;
  }
  if (v === "" || v === "true" || v === "1") {
    return true;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    addWarning(ctx, "blur", v, "must be a boolean or number between 0.3 and 1000");
    return undefined;
  }
  if (n < 0.3) {
    addWarning(ctx, "blur", v, "must be at least 0.3");
    return 0.3;
  }
  if (n > 1000) {
    addWarning(ctx, "blur", v, "must be at most 1000");
    return 1000;
  }
  return n;
}

function parseQuality(params: QueryParams, ctx: ParseContext): number | undefined {
  const v = params["quality"];
  if (v == null || v === "") {
    return undefined;
  }
  const value = parseU32Value(v);
  if (value == null) {
    addWarning(ctx, "quality", v, "must be a positive integer");
    return undefined;
  }
  if (value < 1) {
    addWarning(ctx, "quality", v, "must be at least 1");
    return 1;
  }
  if (value > 100) {
    addWarning(ctx, "quality", v, "must be at most 100");
    return 100;
  }
  return value;
}

function parseEffort(
  params: QueryParams,
  format: ImageType,
  ctx: ParseContext,
): number | undefined {
  const v = params["effort"];
  if (v == null || v === "") {
    return undefined;
  }
  const value = parseU32Value(v);
  if (value == null) {
    addWarning(ctx, "effort", v, "must be a positive integer");
    return undefined;
  }

  let low;
  let high;
  switch (format) {
    case ImageType.Avif:
    case ImageType.Heic:
      low = 0;
      high = 9;
      break;
    case ImageType.Gif:
    case ImageType.Png:
      low = 1;
      high = 10;
      break;
    case ImageType.JpegXL:
      low = 1;
      high = 9;
      break;
    case ImageType.Webp:
      low = 0;
      high = 6;
      break;
    default:
      return undefined;
  }
  if (value < low) {
    addWarning(ctx, "effort", v, `must be at least ${low} for ${format}`);
    return low;
  }
  if (value > high) {
    addWarning(ctx, "effort", v, `must be at most ${high} for ${format}`);
    return high;
  }
  return value;
}

function parseDimension(
  params: QueryParams,
  key: string,
  ctx: ParseContext,
): number | undefined {
  const v = params[key];
  if (v == null || v === "") {
    return undefined;
  }

  const value = parseU32Value(v);
  if (value == null) {
    addWarning(ctx, key, v, "must be a positive integer");
    return undefined;
  }
  if (value < 1) {
    addWarning(ctx, key, v, "must be at least 1");
    return 1;
  }
  if (value > ctx.dimensionLimit) {
    addWarning(ctx, key, v, `must be at most ${ctx.dimensionLimit}`);
    return ctx.dimensionLimit;
  }
  return value;
}

// Helper function to parse a u32 value from a string
function parseU32Value(v: string): number | undefined {
  // strict-ish u32 parsing
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  if (!Number.isInteger(n)) {
    return undefined;
  }
  if (n < 0 || n > 0xffff_ffff) {
    return undefined;
  }
  return n;
}

function getMimetype(format: ImageType): string {
  switch (format) {
    case ImageType.Avif:
      return "image/avif";
    case ImageType.Gif:
      return "image/gif";
    case ImageType.Heic:
      return "image/heic";
    case ImageType.Jpeg:
      return "image/jpeg";
    case ImageType.JpegXL:
      return "image/jxl";
    case ImageType.Png:
      return "image/png";
    case ImageType.Pdf:
      return "application/pdf";
    case ImageType.Raw:
      return "application/octet-stream";
    case ImageType.Svg:
      return "image/svg+xml";
    case ImageType.Tiff:
      return "image/tiff";
    case ImageType.Webp:
      return "image/webp";
  }
}

function getImageType(raw: string): ImageType | null {
  switch (raw) {
    case "avif":
      return ImageType.Avif;
    case "gif":
      return ImageType.Gif;
    case "heic":
      return ImageType.Heic;
    case "jpeg":
    case "jpg":
      return ImageType.Jpeg;
    case "jxl":
      return ImageType.JpegXL;
    case "pdf":
      return ImageType.Pdf;
    case "png":
      return ImageType.Png;
    case "raw":
      return ImageType.Raw;
    case "svg":
      return ImageType.Svg;
    case "tiff":
    case "tif":
      return ImageType.Tiff;
    case "webp":
      return ImageType.Webp;
    default:
      return null;
  }
}

const IMAGE_FIT_SET = new Set<string>(Object.values(ImageFit));
const VALID_FITS = Object.values(ImageFit).join(", ");

function parseImageFit(params: QueryParams, ctx: ParseContext): ImageFit | undefined {
  const fit = params["fit"];
  if (fit == null) {
    return undefined;
  }
  if (!IMAGE_FIT_SET.has(fit)) {
    addWarning(ctx, "fit", fit, `unknown value, valid: ${VALID_FITS}`);
    return undefined;
  }
  return fit as ImageFit;
}

const IMAGE_KERNEL_SET = new Set<string>(Object.values(ImageKernel));
const VALID_KERNELS = Object.values(ImageKernel).join(", ");

function parseImageKernel(
  params: QueryParams,
  ctx: ParseContext,
): ImageKernel | undefined {
  const kernel = params["kernel"];
  if (kernel == null) {
    return undefined;
  }
  if (!IMAGE_KERNEL_SET.has(kernel)) {
    addWarning(ctx, "kernel", kernel, `unknown value, valid: ${VALID_KERNELS}`);
    return undefined;
  }
  return kernel as ImageKernel;
}

const IMAGE_POSITION_SET = new Set<string>(Object.values(ImagePosition));
const VALID_POSITIONS = Object.values(ImagePosition).join(", ");

function parseImagePosition(
  params: QueryParams,
  ctx: ParseContext,
): ImagePosition | undefined {
  const position = params["position"];
  if (position == null) {
    return undefined;
  }
  if (!IMAGE_POSITION_SET.has(position)) {
    addWarning(ctx, "position", position, `unknown value, valid: ${VALID_POSITIONS}`);
    return undefined;
  }
  return position as ImagePosition;
}

const IMAGE_PRESET_SET = new Set<string>(IMAGE_PRESETS);
const VALID_PRESETS = IMAGE_PRESETS.join(", ");

function parseImagePreset(
  params: QueryParams,
  ctx: ParseContext,
): ImagePreset | undefined {
  const preset = params["preset"];
  if (preset == null) {
    return undefined;
  }
  if (!IMAGE_PRESET_SET.has(preset)) {
    addWarning(ctx, "preset", preset, `unknown value, valid: ${VALID_PRESETS}`);
    return undefined;
  }
  return preset as ImagePreset;
}

type QueryParams = Record<string, string | undefined>;

// Export for testing
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
