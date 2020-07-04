export enum ImageType {
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
  perform(buf: Buffer, ops: ImageOptions): Promise<ImageResult>;
}

export interface Fetcher {
  fetch(url: string): Promise<Buffer>;
}

export interface TlsConfig {
  key: Buffer;
  cert: Buffer;
}
