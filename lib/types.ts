import { performance } from "perf_hooks";

export enum ImageType {
  Avif = "avif",
  Jpeg = "jpeg",
  Png = "png",
  Tiff = "tiff",
  WebP = "webp",
}

export enum CropType {
  Attention = "attention",
  Centre = "centre",
  Entropy = "entropy",
}

export interface ImageOptions {
  blur?: number;
  crop?: CropType;
  format: ImageType;
  height?: number;
  lossless?: boolean;
  progressive?: boolean;
  quality: number;
  width?: number;
}

export interface ImageInfo {
  height: number;
  size: number;
  width: number;
}

export interface ImageResult {
  data: Buffer;
  info: ImageInfo;
}

export interface ImageService {
  perform(
    ctx: RequestContext,
    buf: Buffer,
    ops: ImageOptions,
  ): Promise<ImageResult>;
}

export interface Fetcher {
  fetch(ctx: RequestContext, url: string | URL): Promise<Buffer>;
}

export interface TlsConfig {
  key: Buffer;
  cert: Buffer;
}

export class PendingEvent {
  private start: number;
  private cb: (ms: number) => void;

  constructor(cb: (ms: number) => void) {
    this.start = performance.now();
    this.cb = cb;
  }

  end(): void {
    this.cb(performance.now() - this.start);
  }
}

interface RequestEvent {
  name: string;
  ms: number;
}

export class RequestContext {
  private events: RequestEvent[] = [];

  recordEvent(name: string): PendingEvent {
    return new PendingEvent((ms: number) => {
      this.events.push({ name, ms });
    });
  }

  serverTimingHeader(): string {
    return this.events
      .map((event) => {
        return `${event.name};dur=${event.ms.toFixed(1)}`;
      })
      .join(", ");
  }
}
