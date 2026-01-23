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

    const ops = parseImageOps(params, accept, this.dimensionLimit);
    if (!this.engine.encoders.includes(ops.format)) {
      throw new HttpError(400, `image: encoding type ${ops.format} is not supported`);
    }

    const data = await this.client.fetch(url);
    await this.performTransform(reply, data, ops, start);
  };

  private transformPut = async (request: FastifyRequest, reply: FastifyReply) => {
    const start = performance.now();
    const params = request.query as QueryParams;

    const acceptHeader = request.headers["accept"];
    const accept = Array.isArray(acceptHeader)
      ? acceptHeader.join(",")
      : (acceptHeader ?? "");

    const ops = parseImageOps(params, accept, this.dimensionLimit);
    if (!this.engine.encoders.includes(ops.format)) {
      throw new HttpError(400, `image: encoding type ${ops.format} is not supported`);
    }

    if (!Buffer.isBuffer(request.body)) {
      throw new HttpError(400, "image data must be provided in the request body");
    }

    await this.performTransform(reply, request.body, ops, start);
  };

  private performTransform = async (
    reply: FastifyReply,
    data: Uint8Array,
    ops: Options,
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

    const data = await this.client.fetch(url);

    await this.metadata(reply, data, params, start);
  };

  private metadataPut = async (request: FastifyRequest, reply: FastifyReply) => {
    const start = performance.now();
    const params = (request.query as QueryParams) || {};

    if (!Buffer.isBuffer(request.body)) {
      throw new HttpError(400, "image data must be provided in the request body");
    }

    await this.metadata(reply, request.body, params, start);
  };

  private metadata = async (
    reply: FastifyReply,
    data: Uint8Array,
    params: QueryParams,
    start: number,
  ) => {
    const res = await this.engine.metadata({
      data,
      exif: parseBoolean(params, "exif") || false,
      stats: parseBoolean(params, "stats") || false,
      thumbhash: parseBoolean(params, "thumbhash") || false,
    });

    const elapsed = Math.round(performance.now() - start);
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
  blur?: boolean;
  greyscale?: boolean;
  lossless?: boolean;
  progressive?: boolean;
  effort?: number;
  fit?: ImageFit;
  kernel?: ImageKernel;
  position?: ImagePosition;
  preset?: ImagePreset;
}

function parseImageOps(
  params: QueryParams,
  accept: string,
  dimensionLimit: number,
): Options {
  return {
    format: parseFormat(params, accept),
    width: parseDimension(params, "width", dimensionLimit),
    height: parseDimension(params, "height", dimensionLimit),
    quality: parseQuality(params),
    blur: parseBoolean(params, "blur"),
    greyscale: parseBoolean(params, "greyscale"),
    lossless: parseBoolean(params, "lossless"),
    progressive: parseBoolean(params, "progressive"),
    effort: parseEffort(params),
    fit: parseImageFit(params),
    kernel: parseImageKernel(params),
    position: parseImagePosition(params),
    preset: parseImagePreset(params),
  };
}

const DEFAULT_FORMAT = ImageType.Jpeg;

function parseFormat(params: QueryParams, accept: string): ImageType {
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
      return DEFAULT_FORMAT;
    }
    return t;
  }

  // Try to pick first option that matches the Accept header.
  const acceptLower = accept.toLowerCase();
  for (const opt of opts) {
    const t = getImageType(opt);
    if (t == null) {
      continue;
    }
    if (acceptLower.includes(getMimetype(t))) {
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
    return DEFAULT_FORMAT;
  }
  return t;
}

function parseBoolean(params: QueryParams, key: string): boolean | undefined {
  const v = params[key];
  if (v == null) {
    return undefined;
  }
  return v !== "false" && v !== "0";
}

function parseQuality(params: QueryParams): number | undefined {
  const value = parseU32(params, "quality");
  if (value && (value < 1 || value > 100)) {
    return undefined;
  }
  return value;
}

function parseEffort(params: QueryParams): number | undefined {
  const value = parseU32(params, "effort");
  if (value != null && (value < 0 || value > 10)) {
    return undefined;
  }
  return value;
}

function parseDimension(
  params: QueryParams,
  key: string,
  limit: number,
): number | undefined {
  const value = parseU32(params, key);
  if (value != null && value > limit) {
    return undefined;
  }
  return value;
}

function parseU32(params: QueryParams, key: string): number | undefined {
  const v = params[key];
  if (v == null || v === "") {
    return undefined;
  }

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

function parseImageFit(params: QueryParams): ImageFit | undefined {
  const fit = params["fit"];
  if (fit == null) {
    return undefined;
  }

  return IMAGE_FIT_SET.has(fit) ? (fit as ImageFit) : undefined;
}

const IMAGE_KERNEL_SET = new Set<string>(Object.values(ImageKernel));

function parseImageKernel(params: QueryParams): ImageKernel | undefined {
  const kernel = params["kernel"];
  if (kernel == null) {
    return undefined;
  }

  return IMAGE_KERNEL_SET.has(kernel) ? (kernel as ImageKernel) : undefined;
}

const IMAGE_POSITION_SET = new Set<string>(Object.values(ImagePosition));

function parseImagePosition(params: QueryParams): ImagePosition | undefined {
  const position = params["position"];
  if (position == null) {
    return undefined;
  }

  return IMAGE_POSITION_SET.has(position) ? (position as ImagePosition) : undefined;
}

const IMAGE_PRESET_SET = new Set<string>(IMAGE_PRESETS);

function parseImagePreset(params: QueryParams): ImagePreset | undefined {
  const preset = params["preset"];
  if (preset == null) {
    return undefined;
  }

  return IMAGE_PRESET_SET.has(preset) ? (preset as ImagePreset) : undefined;
}

type QueryParams = Record<string, string | undefined>;

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
