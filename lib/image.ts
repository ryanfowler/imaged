import { getExif } from "./exif";
import { Semaphore } from "./semaphore";
import {
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

export class ImageEngine {
  private sema: Semaphore;
  private static DEFAULT_OPS = { autoOrient: true };

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

    if (ops.width || ops.height) {
      img = img.resize({
        width: ops.width,
        height: ops.height,
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
  switch (ops.format) {
    case ImageType.Avif:
      return img.avif({
        quality: ops.quality || 50,
        effort: 2,
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
      return img.webp({ quality: ops.quality || 75, lossless: ops.lossless });
  }
}

function roundTo3(n: number): number {
  return Number(Math.round((n + Number.EPSILON) * 1e3) / 1e3);
}
