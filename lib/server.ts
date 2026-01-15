import type { Client } from "./client.ts";
import type { ImageEngine } from "./image.ts";
import { HttpError, ImageFit, ImageKernel, ImagePosition, ImageType } from "./types.ts";

import { readFileSync } from "node:fs";

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

export class Server {
  private client: Client;
  private engine: ImageEngine;
  private bodyLimit: number;

  constructor(client: Client, engine: ImageEngine, bodyLimitBytes: number) {
    this.client = client;
    this.engine = engine;
    this.bodyLimit = bodyLimitBytes;
  }

  async serve(): Promise<string> {
    const server = Fastify({ bodyLimit: this.bodyLimit, keepAliveTimeout: 10_000 });
    server.setErrorHandler(errorHandler);
    server.setNotFoundHandler(notFoundHandler);
    registerSignals(server);

    server.addContentTypeParser("*", { parseAs: "buffer" }, (_, body, done) => {
      done(null, body);
    });

    server.get("/dynamic", this.dynamicGet);
    server.put("/dynamic", this.dynamicPut);
    server.get("/metadata", this.metadataGet);
    server.put("/metadata", this.metadataPut);

    return await server.listen({ port: getPort(process.env.PORT) });
  }

  private dynamicGet = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.query as QueryParams;

    const url = params["url"];
    if (!url) {
      throw new HttpError(400, "missing 'url' query parameter");
    }

    const acceptHeader = request.headers["accept"];
    const accept = Array.isArray(acceptHeader)
      ? acceptHeader.join(",")
      : (acceptHeader ?? "");

    const ops = parseImageOps(params, accept);
    if (!this.engine.encoders[ops.format]) {
      throw new HttpError(400, `image: encoding type ${ops.format} is not supported`);
    }

    const data = await this.client.fetch(url);
    await this.performDynamic(reply, data, ops);
  };

  private dynamicPut = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.query as QueryParams;

    const acceptHeader = request.headers["accept"];
    const accept = Array.isArray(acceptHeader)
      ? acceptHeader.join(",")
      : (acceptHeader ?? "");

    const ops = parseImageOps(params, accept);
    if (!this.engine.encoders[ops.format]) {
      throw new HttpError(400, `image: encoding type ${ops.format} is not supported`);
    }

    if (!Buffer.isBuffer(request.body)) {
      throw new HttpError(400, "image data must be provided in the request body");
    }

    await this.performDynamic(reply, request.body, ops);
  };

  private performDynamic = async (
    reply: FastifyReply,
    data: Uint8Array,
    ops: Options,
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
    });

    reply
      .header("content-type", getMimetype(img.format))
      .header("x-image-width", String(img.width))
      .header("x-image-height", String(img.height));
    return reply.send(img.data);
  };

  private metadataGet = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = (request.query as QueryParams) || {};

    const url = params["url"];
    if (!url) {
      return reply.code(400).send("missing 'url' query parameter");
    }

    const data = await this.client.fetch(url);

    await this.metadata(reply, data, params);
  };

  private metadataPut = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = (request.query as QueryParams) || {};

    if (!Buffer.isBuffer(request.body)) {
      throw new HttpError(400, "image data must be provided in the request body");
    }

    await this.metadata(reply, request.body, params);
  };

  private metadata = async (
    reply: FastifyReply,
    data: Uint8Array,
    params: QueryParams,
  ) => {
    const res = await this.engine.metadata({
      data,
      exif: parseBoolean(params, "exif") || false,
      stats: parseBoolean(params, "stats") || false,
      thumbhash: parseBoolean(params, "thumbhash") || false,
    });

    return reply.send(res);
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
}

function parseImageOps(params: QueryParams, accept: string): Options {
  return {
    format: parseFormat(params, accept),
    width: parseU32(params, "width"),
    height: parseU32(params, "height"),
    quality: parseQuality(params),
    blur: parseBoolean(params, "blur"),
    greyscale: parseBoolean(params, "greyscale"),
    lossless: parseBoolean(params, "lossless"),
    progressive: parseBoolean(params, "progressive"),
    effort: parseU32(params, "effort"),
    fit: parseImageFit(params),
    kernel: parseImageKernel(params),
    position: parseImagePosition(params),
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

export function getVersion(): string {
  const pkgPath = new URL("./../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

export function getPort(raw: string | undefined): number {
  const defaultPort = 8000;

  const num = getEnvNum(raw, 8000);
  if (num <= 0 || num > 65535) {
    return defaultPort;
  }
  return num;
}

export function getConcurrency(): number {
  const defaultCon = Math.ceil(navigator.hardwareConcurrency * 1.2);
  const concurrency = getEnvNum(process.env.CONCURRENCY, defaultCon);
  if (concurrency <= 0) {
    return 1;
  }
  return concurrency;
}

function getEnvNum(raw: string | undefined, defaultNum: number): number {
  if (!raw) {
    return defaultNum;
  }

  const num = Number.parseInt(raw, 10);
  if (!Number.isInteger(num)) {
    return defaultNum;
  }

  return num;
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

function registerSignals(server: FastifyInstance) {
  const shutdown = async (signal: string) => {
    console.log(`Received signal: ${signal}, shutting down`);

    const forceExit = setTimeout(() => {
      console.log("Timeout reached, forcing exit");
      process.exit(1);
    }, 10_000);

    try {
      await server.close();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      console.log(`Error shutting down: ${err}`);
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export function getRuntimeVersion() {
  if (process.versions.bun) {
    return `Bun ${process.versions.bun}`;
  }
  return `Node.js ${process.version}`;
}
