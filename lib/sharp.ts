import {
  CropType,
  ImageOptions,
  ImageType,
  ImageResult,
  ImageService,
  RequestContext,
} from "./types";
import { Semaphore } from "./semaphore";

import sharp from "sharp";

sharp.cache(false);

type ImageFormat = "avif" | "jpeg" | "png" | "tiff" | "webp";

const imageFormats: { [_ in ImageType]: ImageFormat } = {
  [ImageType.Avif]: "avif",
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

  perform = async (
    ctx: RequestContext,
    buf: Buffer,
    ops: ImageOptions,
  ): Promise<ImageResult> => {
    const acquireEvent = ctx.recordEvent("acquire_perform");
    try {
      await this.sema.acquire();
    } finally {
      acquireEvent.end();
    }

    const performEvent = ctx.recordEvent("perform");
    try {
      return await performOp(buf, ops);
    } finally {
      performEvent.end();
      this.sema.release();
    }
  };
}

const performOp = (buf: Buffer, ops: ImageOptions): Promise<ImageResult> => {
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
