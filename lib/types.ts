export enum ImageType {
  Avif,
  Gif,
  Jpeg,
  Png,
  Tiff,
  Webp,
}

export enum ImageFit {
  Cover = "cover",
  Contain = "contain",
  Fill = "fill",
  Inside = "inside",
  Outside = "outside",
}

export enum ImageKernel {
  Nearest = "nearest",
  Linear = "linear",
  Cubic = "cubic",
  Mitchell = "mitchell",
  Lanczos2 = "lanczos2",
  Lanczos3 = "lanczos3",
  MKS2013 = "mks2013",
  MKS2021 = "mks2021",
}

export enum ImagePosition {
  Top = "top",
  RightTop = "right top",
  Right = "right",
  RightBottom = "right bottom",
  Bottom = "bottom",
  LeftBottom = "left bottom",
  Left = "left",
  LeftTop = "left top",
  North = "north",
  NorthEast = "northeast",
  East = "east",
  SouthEast = "southeast",
  South = "south",
  SouthWest = "southwest",
  West = "west",
  NorthWest = "northwest",
  Center = "center",
  Centre = "centre",
  Entropy = "entropy",
  Attention = "attention",
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
  fit?: ImageFit;
  kernel?: ImageKernel;
  position?: ImagePosition;
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
