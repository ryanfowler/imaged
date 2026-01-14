import { getExif } from "./exif.ts";
import { Semaphore } from "./semaphore.ts";
import {
  HttpError,
  ImageFit,
  type ImageOptions,
  type ImageResult,
  ImageType,
  type MetadataOptions,
  type MetadataResult,
} from "./types.ts";

import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";

sharp.cache(false);
sharp.concurrency(1);

const MAX_SIZE = 12_000;

export class ImageEngine {
  private sema: Semaphore;
  private static DEFAULT_OPS = {
    autoOrient: true,
    limitInputPixels: 50_000_000,
  };

  static VERSIONS = sharp.versions;

  constructor(concurrency: number) {
    this.sema = new Semaphore(concurrency);
  }

  async perform(ops: ImageOptions): Promise<ImageResult> {
    const _input = detectImageFormat(ops.data);

    await this.sema.acquire();
    try {
      return await this.performInner(ops);
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }
      if (err instanceof Error) {
        throw new HttpError(400, `image: ${err.message}`);
      }
      throw new HttpError(400, `image: ${err}`);
    } finally {
      this.sema.release();
    }
  }

  private async performInner(ops: ImageOptions): Promise<ImageResult> {
    let img = sharp(ops.data, ImageEngine.DEFAULT_OPS);

    let meta = await img.metadata();
    if (meta.height > MAX_SIZE || meta.width > MAX_SIZE) {
      const msg = `maximum dimension must be less than ${MAX_SIZE}px`;
      throw new HttpError(400, msg);
    }
    let final = getFinalSize(meta.width, meta.height, ops.width, ops.height, ops.fit);

    if (ops.width || ops.height) {
      img = img.resize({
        width: ops.width,
        height: ops.height,
        fit: ops.fit,
        kernel: ops.kernel,
        position: ops.position,
        withoutEnlargement: true,
      });
    }

    if (ops.greyscale) {
      img = img.gamma().greyscale();
    }

    if (ops.blur) {
      img = img.blur(10);
    }

    img = applyFormat(img, ops, final.width, final.height);

    const out = await img.toBuffer({ resolveWithObject: true });
    return {
      data: out.data,
      format: ops.format,
      width: out.info.width,
      height: out.info.height,
    };
  }

  async metadata(ops: MetadataOptions): Promise<MetadataResult> {
    const _input = detectImageFormat(ops.data);

    await this.sema.acquire();
    try {
      return await this.metadataInner(ops);
    } catch (err) {
      if (err instanceof Error) {
        throw new HttpError(400, `image: ${err.message}`);
      }
      throw new HttpError(400, `image: ${err}`);
    } finally {
      this.sema.release();
    }
  }

  private async metadataInner(ops: MetadataOptions): Promise<MetadataResult> {
    const img = sharp(ops.data, ImageEngine.DEFAULT_OPS);
    const meta = await img.metadata();

    let exif;
    if (ops.exif && meta.exif) {
      exif = getExif(meta.exif);
    }

    let stats;
    if (ops.stats) {
      const { entropy, sharpness, dominant } = await img.stats();
      stats = {
        entropy: roundTo3(entropy),
        sharpness: roundTo3(sharpness),
        dominant,
      };
    }

    let thumbhash;
    if (ops.thumbhash) {
      const { data, info } = await img
        .resize({
          width: 100,
          height: 100,
          fit: "inside",
          withoutEnlargement: true,
          kernel: "nearest",
        })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const rawThumbhash = rgbaToThumbHash(info.width, info.height, data);
      thumbhash = Buffer.from(rawThumbhash).toString("base64");
    }

    let format: string = meta.format;
    if (format === "heif") {
      if (meta.compression === "av1") {
        format = "avif";
      } else if (meta.compression === "hevc") {
        format = "heic";
      }
    }

    return {
      format,
      width: meta.autoOrient.width || meta.width,
      height: meta.autoOrient.height || meta.height,
      size: ops.data.length,
      exif,
      stats,
      thumbhash,
    };
  }
}

function applyFormat(
  img: sharp.Sharp,
  ops: ImageOptions,
  width: number,
  height: number,
): sharp.Sharp {
  switch (ops.format) {
    case ImageType.Avif:
      return img.avif({
        quality: ops.quality || 45,
        effort: ops.effort || 2,
        chromaSubsampling: "4:2:0",
        lossless: ops.lossless,
      });
    case ImageType.Gif:
      return img.gif({ effort: 4 });
    case ImageType.Heic:
      return img.heif({
        compression: "hevc",
        quality: ops.quality || 45,
        effort: ops.effort || 2,
        chromaSubsampling: "4:2:0",
        lossless: ops.lossless,
      });
    case ImageType.Jpeg:
      return img.jpeg({
        quality: ops.quality || 75,
        progressive: getProgressiveValue(width, height, ops.progressive),
      });
    case ImageType.JpegXL:
      return img.jxl({
        quality: ops.quality,
        effort: 5,
        lossless: ops.lossless,
      });
    case ImageType.Png:
      return img.png({ quality: ops.quality || 75 });
    case ImageType.Tiff:
      return img.tiff({ quality: ops.quality || 75 });
    case ImageType.Webp:
      return img.webp({
        quality: ops.quality || 75,
        lossless: ops.lossless,
        effort: ops.effort || 4,
      });
  }
}

function getFinalSize(
  srcW: number,
  srcH: number,
  reqW?: number,
  reqH?: number,
  fit?: ImageFit,
): { width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) {
    throw new Error("invalid source dimensions");
  }

  const scale = computeScale(srcW, srcH, reqW, reqH, fit);

  return {
    width: Math.round(srcW * scale),
    height: Math.round(srcH * scale),
  };
}

function computeScale(
  srcW: number,
  srcH: number,
  reqW?: number,
  reqH?: number,
  fit?: ImageFit,
): number {
  // If neither dimension is provided, scale = 1 (original size)
  if (!reqW && !reqH) {
    return 1;
  }

  // If only one dimension is provided, aspect ratio is fixed
  if (reqW && !reqH) return reqW / srcW;
  if (!reqW && reqH) return reqH / srcH;

  // Both provided → fit logic applies
  const scaleW = reqW! / srcW;
  const scaleH = reqH! / srcH;

  if (fit === ImageFit.Inside) {
    return Math.min(scaleW, scaleH);
  }
  return Math.max(scaleW, scaleH);
}

function getProgressiveValue(width: number, height: number, value?: boolean): boolean {
  if (value != null) {
    return value;
  }

  // Avoid progressive optimization for small or large images.
  const size = width * height;
  return size >= 100_000 && size <= 9_000_000;
}

function roundTo3(n: number): number {
  return Number(Math.round((n + Number.EPSILON) * 1e3) / 1e3);
}

export function detectImageFormat(buf: Uint8Array): ImageType {
  if (buf.length < 12) {
    throw new HttpError(400, `image: unknown image type`);
  }

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return ImageType.Jpeg;
  }

  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return ImageType.Png;
  }

  // GIF
  // if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
  //   return ImageType.Gif;
  // }

  // WebP
  if (
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  ) {
    return ImageType.Webp;
  }

  // TIFF
  if (
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
    (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)
  ) {
    return ImageType.Tiff;
  }

  // BMP
  // if (buf[0] === 0x42 && buf[1] === 0x4d) {
  //   return ImageType.Bmp;
  // }

  // ICO
  // if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
  //   return ImageType.Ico;
  // }

  // PSD
  // if (buf[0] === 0x38 && buf[1] === 0x42 && buf[2] === 0x50 && buf[3] === 0x53) {
  //   return ImageType.Psd;
  // }

  // JPEG XL
  if (
    (buf[0] === 0xff && buf[1] === 0x0a) ||
    (buf[0] === 0x00 &&
      buf[1] === 0x00 &&
      buf[2] === 0x00 &&
      buf[3] === 0x0c &&
      buf[4] === 0x4a && // J
      buf[5] === 0x58 && // X
      buf[6] === 0x4c && // L
      buf[7] === 0x20)
  ) {
    return ImageType.JpegXL;
  }

  // HEIC / AVIF
  if (
    buf[4] === 0x66 && // f
    buf[5] === 0x74 && // t
    buf[6] === 0x79 && // y
    buf[7] === 0x70
  ) {
    const brand = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!);

    if (brand.startsWith("avif")) return ImageType.Avif;
    if (brand.startsWith("heic")) return ImageType.Heic;
    if (brand.startsWith("heix")) return ImageType.Heic;
    if (brand.startsWith("hevc")) return ImageType.Heic;
    // if (brand.startsWith("heif")) return ImageType.HEIF;
    // if (brand.startsWith("mif1")) return ImageType.HEIF;
  }

  // SVG
  // const header = buf.subarray(0, 200).toString().trim();
  // if (header.startsWith("<svg") || header.includes("<svg")) {
  //   return ImageType.Svg;
  // }

  throw new HttpError(400, "image: unknown image type");
}
