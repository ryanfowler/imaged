import { getExif } from "./exif.ts";
import { getPreset } from "./presets.ts";
import { Semaphore } from "./semaphore.ts";
import {
  HttpError,
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

export interface ImageEngineOptions {
  concurrency: number;
  pixelLimit: number;
}

export class ImageEngine {
  private sema: Semaphore;
  private sharpOptions: { autoOrient: boolean; limitInputPixels: number };

  decoders: ImageType[];
  encoders: ImageType[];

  static VERSIONS = sharp.versions;

  constructor(options: ImageEngineOptions) {
    this.sema = new Semaphore(options.concurrency);
    this.sharpOptions = {
      autoOrient: true,
      limitInputPixels: options.pixelLimit,
    };

    this.decoders = parseDecoders();
    this.encoders = parseEncoders();
  }

  async perform(ops: ImageOptions): Promise<ImageResult> {
    const input = detectImageFormat(ops.data);
    if (!this.decoders.includes(input)) {
      throw new HttpError(400, `image: decoding type ${input} is not supported`);
    }

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
      throw new HttpError(500, `image: internal error`);
    } finally {
      this.sema.release();
    }
  }

  private async performInner(ops: ImageOptions): Promise<ImageResult> {
    let img = sharp(ops.data, this.sharpOptions);

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
    const input = detectImageFormat(ops.data);
    if (!this.decoders.includes(input)) {
      throw new HttpError(400, `image: decoding type ${input} is not supported`);
    }

    await this.sema.acquire();
    try {
      return await this.metadataInner(input, ops);
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }
      if (err instanceof Error) {
        throw new HttpError(400, `image: ${err.message}`);
      }
      throw new HttpError(500, `image: internal error`);
    } finally {
      this.sema.release();
    }
  }

  private async metadataInner(
    input: ImageType,
    ops: MetadataOptions,
  ): Promise<MetadataResult> {
    const img = sharp(ops.data, this.sharpOptions);
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
        .clone()
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

    return {
      format: input,
      width: meta.autoOrient?.width || meta.width,
      height: meta.autoOrient?.height || meta.height,
      size: ops.data.length,
      exif,
      stats,
      thumbhash,
    };
  }
}

function applyFormat(img: sharp.Sharp, ops: ImageOptions): sharp.Sharp {
  const preset = getPreset(ops.format, ops.preset);
  switch (ops.format) {
    case ImageType.Avif:
      return img.avif({
        quality: ops.quality || preset.quality,
        effort: ops.effort || preset.effort,
        chromaSubsampling: preset.chromaSubsampling,
        lossless: ops.lossless,
      });
    case ImageType.Gif:
      return img.gif({ effort: 4 });
    case ImageType.Heic:
      return img.heif({
        compression: "hevc",
        quality: ops.quality || preset.quality,
        effort: ops.effort || preset.effort,
        chromaSubsampling: preset.chromaSubsampling,
        lossless: ops.lossless,
      });
    case ImageType.Jpeg:
      return img.jpeg({
        quality: ops.quality || preset.quality,
        progressive: ops.progressive || preset.progressive,
        chromaSubsampling: preset.chromaSubsampling,
        mozjpeg: preset.mozjpeg,
        optimiseCoding: preset.optimiseCoding,
      });
    case ImageType.JpegXL:
      return img.jxl({
        quality: ops.quality || preset.quality,
        effort: ops.effort || preset.effort,
        decodingTier: preset.decodingTier,
        lossless: ops.lossless,
      });
    case ImageType.Pdf:
      throw new HttpError(400, "image: encoding type pdf is not supported");
    case ImageType.Png:
      return img.png({
        quality: ops.quality,
        compressionLevel: preset.compressionLevel,
        adaptiveFiltering: preset.adaptiveFiltering,
        palette: preset.palette,
        effort: preset.effort,
        colours: preset.colours,
      });
    case ImageType.Raw:
      return img.raw();
    case ImageType.Svg:
      throw new HttpError(400, "image: encoding type svg is not supported");
    case ImageType.Tiff:
      return img.tiff({
        quality: ops.quality || preset.quality,
        compression: preset.compression,
        predictor: preset.predictor,
      });
    case ImageType.Webp:
      return img.webp({
        quality: ops.quality || preset.quality,
        lossless: ops.lossless,
        effort: ops.effort || preset.effort,
        smartSubsample: preset.smartSubsample,
        smartDeblock: preset.smartDeblock,
        alphaQuality: preset.alphaQuality,
      });
  }
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
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return ImageType.Gif;
  }

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

  // PDF
  if (
    buf[0] === 0x25 && // %
    buf[1] === 0x50 && // P
    buf[2] === 0x44 && // D
    buf[3] === 0x46 && // F
    buf[4] === 0x2d // -
  ) {
    return ImageType.Pdf;
  }

  // SVG
  if (isLikelySvg(buf)) {
    return ImageType.Svg;
  }

  throw new HttpError(400, "image: unknown image type");
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

function isLikelySvg(buf: Uint8Array): boolean {
  const max = Math.min(buf.length, 4096);

  // Quick binary check: if any NUL bytes exist in the sample, it's not SVG.
  // This avoids unnecessary UTF-8 decoding for binary formats.
  for (let i = 0; i < max; i++) {
    if (buf[i] === 0) return false;
  }

  let s = TEXT_DECODER.decode(buf.subarray(0, max));

  // Strip UTF-8 BOM if present.
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  // Find the first "<" that begins something meaningful (skip leading whitespace).
  // Then accept common preambles before <svg>.
  // We'll search for "<svg" but only if it appears before an "<html" (avoid HTML docs with inline svg).
  // Use case-insensitive search to avoid lowercasing the entire string.
  const svgIdx = s.search(/<svg/i);
  if (svgIdx === -1) return false;

  const htmlIdx = s.search(/<html/i);
  if (htmlIdx !== -1 && htmlIdx < svgIdx) return false;

  // Also avoid mistaking random text that contains "<svg" deep inside after huge headers.
  // Ensure it's reasonably near the start (after optional XML/doctype/comments).
  if (svgIdx > 1024) return false;

  return true;
}

function parseDecoders(): ImageType[] {
  const f = sharp.format;
  const obj: { [K in ImageType]: boolean } = {
    avif:
      (f.heif?.input.buffer && f.heif?.input.fileSuffix?.includes(".avif")) || false,
    gif: f.gif?.input.buffer || false,
    heic: (f.heif.input.buffer && f.heif.input.fileSuffix?.includes(".heic")) || false,
    jpeg: f.jpeg?.input.buffer || false,
    jxl: f.jxl?.input.buffer || false,
    pdf: f.pdf?.input.buffer || false,
    png: f.png?.input.buffer || false,
    raw: false,
    svg: f.svg?.input.buffer || false,
    tiff: f.tiff?.input.buffer || false,
    webp: f.webp?.input.buffer || false,
  };

  return Object.entries(obj)
    .filter(([_, val]) => val)
    .map(([key, _]) => key as ImageType);
}

function parseEncoders(): ImageType[] {
  const f = sharp.format;
  const obj: { [K in ImageType]: boolean } = {
    avif: (f.heif?.output.buffer && f.heif?.output.alias?.includes("avif")) || false,
    gif: f.gif?.output.buffer || false,
    heic: (f.heif?.output.buffer && f.heif?.output.alias?.includes("heic")) || false,
    jpeg: f.jpeg?.output.buffer || false,
    jxl: f.jxl?.output.buffer || false,
    pdf: false,
    png: f.png?.output.buffer || false,
    raw: f.raw?.output.buffer || false,
    svg: false,
    tiff: f.tiff?.output.buffer || false,
    webp: f.webp?.output.buffer || false,
  };

  return Object.entries(obj)
    .filter(([_, val]) => val)
    .map(([key, _]) => key as ImageType);
}
