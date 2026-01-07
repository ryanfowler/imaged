import { getExif } from "./exif";
import { Semaphore } from "./semaphore";
import {
  ImageFit,
  type ImageOptions,
  type ImageResult,
  ImageType,
  type MetadataOptions,
  type MetadataResult,
} from "./types";

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
    await this.sema.acquire();
    try {
      return await this.performInner(ops);
    } catch (err) {
      if (err instanceof Error) {
        throw new Response(err.toString(), { status: 400 });
      }
      throw err;
    } finally {
      this.sema.release();
    }
  }

  private async performInner(ops: ImageOptions): Promise<ImageResult> {
    let img = sharp(ops.data, ImageEngine.DEFAULT_OPS);

    let meta = jpegDimensions(ops.data);
    if (meta == null) {
      meta = await img.metadata();
    }
    if (meta.height > MAX_SIZE || meta.width > MAX_SIZE) {
      throw new Response("maximum dimension must be less than 12,000px", {
        status: 400,
      });
    }

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

    img = applyFormat(img, ops);

    const out = await img.toBuffer({ resolveWithObject: true });
    return {
      data: out.data,
      format: ops.format,
      width: out.info.width,
      height: out.info.height,
    };
  }

  async metadata(ops: MetadataOptions): Promise<MetadataResult> {
    await this.sema.acquire();
    try {
      return await this.metadataInner(ops);
    } catch (err) {
      if (err instanceof Error) {
        throw new Response(err.toString(), { status: 400 });
      }
      throw err;
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

      thumbhash = rgbaToThumbHash(info.width, info.height, data).toBase64();
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

function applyFormat(img: sharp.Sharp, ops: ImageOptions): sharp.Sharp {
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
    case ImageType.Jpeg:
      return img.jpeg({
        quality: ops.quality || 75,
        progressive: ops.progressive,
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

function getProgressiveValue(
  width: number,
  height: number,
  value?: boolean
): boolean {
  if (value != null) {
    return value;
  }

  const size = width * height;

  // Avoid progressive optimization for small or large images.
  return size >= 100_000 && size <= 9_000_000;
}

function roundTo3(n: number): number {
  return Number(Math.round((n + Number.EPSILON) * 1e3) / 1e3);
}

function jpegDimensions(
  buf: Uint8Array
): { width: number; height: number } | null {
  const n = buf.length;
  if (n < 4) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI

  let i = 2;

  while (i < n) {
    // Find 0xFF marker prefix (skip any non-0xFF junk defensively)
    while (i < n && buf[i] !== 0xff) i++;
    if (i >= n) return null;

    // Skip fill bytes 0xFF 0xFF 0xFF...
    while (i < n && buf[i] === 0xff) i++;
    if (i >= n) return null;

    const marker = buf[i]!;
    i++;

    // Standalone markers (no length field)
    // SOI (D8) shouldn't appear again, but harmless
    // EOI (D9) ends image
    // TEM (01)
    // RST0..RST7 (D0..D7)
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      if (marker === 0xd9) return null; // EOI reached without SOF
      continue;
    }

    // Need segment length
    if (i + 1 >= n) return null;
    const segLen = u16be(buf, i);
    i += 2;

    // Length includes the two length bytes; must be >= 2
    if (segLen < 2) return null;
    const payloadLen = segLen - 2;
    if (i + payloadLen > n) return null; // truncated

    // SOF markers (baseline/progressive/etc.) contain dimensions.
    const isSOF =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;

    if (isSOF) {
      // Need: precision (1) + height (2) + width (2) = 5 bytes
      if (payloadLen < 5) return null;
      const height = u16be(buf, i + 1);
      const width = u16be(buf, i + 3);
      if (!validDims(width, height)) return null;
      return { width, height };
    }

    // Skip segment payload
    i += payloadLen;
  }

  return null;
}

function validDims(w: number, h: number): boolean {
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0;
}

function u16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}
