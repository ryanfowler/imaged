import type { Client } from "./client.ts";
import type { ImageEngine } from "./image.ts";
import { ImageFit, ImageKernel, ImagePosition, ImageType } from "./types.ts";

export class Server {
  private client: Client;
  private engine: ImageEngine;

  constructor(client: Client, engine: ImageEngine) {
    this.client = client;
    this.engine = engine;
  }

  serve(port: string | number): Bun.Server<undefined> {
    return Bun.serve({
      port,
      routes: {
        "/dynamic": httpWrap(this.dynamic),
        "/metadata": httpWrap(this.metadata),
      },
      idleTimeout: 30,
    });
  }

  private dynamic = async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return resMethodNotAllowed;
    }

    const params = new URL(request.url).searchParams;
    const accept = request.headers.get("accept") ?? "";
    const ops = parseImageOps(params, accept);

    const data = await this.client.fetch(ops.url);

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

    return new Response(img.data, {
      headers: {
        "content-type": getMimetype(img.format),
        "x-image-width": img.width.toString(),
        "x-image-height": img.height.toString(),
      },
    });
  };

  private metadata = async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return resMethodNotAllowed;
    }

    const params = new URL(request.url).searchParams;
    const url = params.get("url");
    if (!url) {
      return new Response("missing 'url' query parameter", { status: 400 });
    }

    const data = await this.client.fetch(url);
    const res = await this.engine.metadata({
      data,
      exif: parseBoolean(params, "exif") || false,
      stats: parseBoolean(params, "stats") || false,
      thumbhash: parseBoolean(params, "thumbhash") || false,
    });
    return Response.json(res);
  };
}

const resMethodNotAllowed = new Response("method not allowed", { status: 405 });

type Handler = (r: Request) => Promise<Response>;

function httpWrap(h: Handler): Handler {
  return async (request: Request): Promise<Response> => {
    try {
      return await h(request);
    } catch (err) {
      if (err instanceof Response) {
        return err;
      }
      console.log(err);
      return new Response("internal server error", { status: 500 });
    }
  };
}

interface Options {
  url: string;
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

function parseImageOps(params: URLSearchParams, accept: string): Options {
  const url = params.get("url");
  if (!url) {
    throw new Response("missing 'url' query parameter", { status: 400 });
  }

  return {
    url,
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

function parseFormat(params: URLSearchParams, accept: string): ImageType {
  const v = params.get("format");
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

function parseBoolean(params: URLSearchParams, key: string): boolean | undefined {
  const v = params.get(key);
  if (v == null) {
    return undefined;
  }
  return v !== "false" && v !== "0";
}

function parseQuality(params: URLSearchParams): number | undefined {
  const value = parseU32(params, "quality");
  if (value && (value < 1 || value > 100)) {
    return undefined;
  }
  return value;
}

function parseU32(params: URLSearchParams, key: string): number | undefined {
  const v = params.get(key);
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
    case ImageType.Jpeg:
      return "image/jpeg";
    case ImageType.Png:
      return "image/png";
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
    case "jpeg":
    case "jpg":
      return ImageType.Jpeg;
    case "png":
      return ImageType.Png;
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

function parseImageFit(params: URLSearchParams): ImageFit | undefined {
  const fit = params.get("fit");
  if (fit == null) {
    return undefined;
  }

  return IMAGE_FIT_SET.has(fit) ? (fit as ImageFit) : undefined;
}

const IMAGE_KERNEL_SET = new Set<string>(Object.values(ImageKernel));

function parseImageKernel(params: URLSearchParams): ImageKernel | undefined {
  const kernel = params.get("kernel");
  if (kernel == null) {
    return undefined;
  }

  return IMAGE_KERNEL_SET.has(kernel) ? (kernel as ImageKernel) : undefined;
}

const IMAGE_POSITION_SET = new Set<string>(Object.values(ImagePosition));

function parseImagePosition(params: URLSearchParams): ImagePosition | undefined {
  const position = params.get("position");
  if (position == null) {
    return undefined;
  }

  return IMAGE_POSITION_SET.has(position) ? (position as ImagePosition) : undefined;
}
