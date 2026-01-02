export enum ImageType {
  Avif,
  Gif,
  Jpeg,
  Png,
  Tiff,
  Webp,
}

export interface ImageOptions {
  data: Uint8Array;
  format: ImageType;
  width?: number;
  height?: number;
  quality?: number;
  blur?: boolean;
  greyscale?: boolean;
  lossless?: boolean;
  progressive?: boolean;
  effort?: number;
}

export interface ImageResult {
  data: Buffer;
  format: ImageType;
  width: number;
  height: number;
}

export interface MetadataOptions {
  data: Uint8Array;
  exif: boolean;
  stats: boolean;
  thumbhash: boolean;
}

export interface MetadataResult {
  format: string;
  width: number;
  height: number;
  size: number;
  exif?: ExifData;
  stats?: Stats;
  thumbhash?: string;
}

export interface Stats {
  entropy: number;
  sharpness: number;
  dominant: { r: number; g: number; b: number };
}

export interface ExifData {
  make?: string;
  model?: string;
  software?: string;
  datetime?: string;
  orientation?: string;
  f_number?: number;
  iso?: number;
  lens_make?: string;
  lens_model?: string;
  latitude?: number;
  longitude?: number;
  // altitude?: number;
  // speed?: number;
}
