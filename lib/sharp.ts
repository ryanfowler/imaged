import {
  CropType,
  ImageOptions,
  ImageType,
  ImageResult,
  ImageService,
} from "./types";
import { Semaphore } from "./semaphore";

import { performance } from "perf_hooks";

import sharp from "sharp";

sharp.cache(false);

const imageFormats: { [_ in ImageType]: string } = {
  [ImageType.Jpeg]: "jpeg",
  [ImageType.Png]: "png",
  [ImageType.Tiff]: "tiff",
  [ImageType.WebP]: "webp",
};

const cropPositions: { [_ in CropType]: string } = {
  [CropType.Attention]: "attention",
  [CropType.Centre]: "centre",
  [CropType.Entropy]: "entropy",
};

interface SharpConfig {
  concurrency: number;
}

export class Sharp implements ImageService {
  private sema: Semaphore;

  constructor(config: SharpConfig) {
    this.sema = new Semaphore(config.concurrency);
  }

  perform = async (buf: Buffer, ops: ImageOptions): Promise<ImageResult> => {
    await this.sema.acquire();
    try {
      const start = performance.now();
      const res = await this.performInner(buf, ops);
      const took = performance.now() - start;
      console.log(`Took ${took.toFixed(0)}ms`);
      return res;
    } finally {
      this.sema.release();
    }
  };

  private performInner = (
    buf: Buffer,
    ops: ImageOptions
  ): Promise<ImageResult> => {
    let tx = sharp(buf, { sequentialRead: true });

    tx = tx.rotate();

    if (ops.blur) {
      tx = tx.blur(ops.blur);
    }

    if (ops.height || ops.width) {
      tx = tx.resize({
        height: ops.height,
        position: ops.crop ? cropPositions[ops.crop] : undefined,
        width: ops.width,
      });
    }

    tx = tx.toFormat(imageFormats[ops.format], {
      lossless: ops.lossless,
      progressive: ops.progressive,
      quality: ops.quality,
    });

    return tx.toBuffer({ resolveWithObject: true });
  };
}
