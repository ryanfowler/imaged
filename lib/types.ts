export const ImageType = {
  Avif: "avif",
  Gif: "gif",
  Heic: "heic",
  Jpeg: "jpeg",
  JpegXL: "jxl",
  Pdf: "pdf",
  Png: "png",
  Raw: "raw",
  Svg: "svg",
  Tiff: "tiff",
  Webp: "webp",
} as const;
export type ImageType = (typeof ImageType)[keyof typeof ImageType];

export const ImageFit = {
  Cover: "cover",
  Contain: "contain",
  Fill: "fill",
  Inside: "inside",
  Outside: "outside",
} as const;
export type ImageFit = (typeof ImageFit)[keyof typeof ImageFit];

export const ImageKernel = {
  Nearest: "nearest",
  Linear: "linear",
  Cubic: "cubic",
  Mitchell: "mitchell",
  Lanczos2: "lanczos2",
  Lanczos3: "lanczos3",
  MKS2013: "mks2013",
  MKS2021: "mks2021",
} as const;
export type ImageKernel = (typeof ImageKernel)[keyof typeof ImageKernel];

export const ImagePosition = {
  Top: "top",
  RightTop: "right top",
  Right: "right",
  RightBottom: "right bottom",
  Bottom: "bottom",
  LeftBottom: "left bottom",
  Left: "left",
  LeftTop: "left top",
  North: "north",
  NorthEast: "northeast",
  East: "east",
  SouthEast: "southeast",
  South: "south",
  SouthWest: "southwest",
  West: "west",
  NorthWest: "northwest",
  Center: "center",
  Centre: "centre",
  Entropy: "entropy",
  Attention: "attention",
} as const;
export type ImagePosition = (typeof ImagePosition)[keyof typeof ImagePosition];

export interface ImageOptions {
  data: Uint8Array;
  format: ImageType;
  width?: number;
  height?: number;
  quality?: number;
  blur?: boolean | number;
  greyscale?: boolean;
  lossless?: boolean;
  progressive?: boolean;
  effort?: number;
  fit?: ImageFit;
  kernel?: ImageKernel;
  position?: ImagePosition;
  preset?: ImagePreset;
}

export const IMAGE_PRESETS = ["default", "quality", "size"] as const;
export type ImagePreset = (typeof IMAGE_PRESETS)[number];

export interface PresetOptions {
  quality?: number;
  progressive?: boolean;
  chromaSubsampling?: string;
  mozjpeg?: boolean;
  effort?: number;
  smartSubsample?: boolean;
  smartDeblock?: boolean;
  alphaQuality?: number;
  decodingTier?: number;
  compressionLevel?: number;
  adaptiveFiltering?: boolean;
  palette?: boolean;
  colours?: number;
  compression?: string;
  predictor?: string;
  reoptimise?: boolean;
  optimiseCoding?: boolean;
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
  space: string;
  channels: number;
  depth: string;
  density?: number;
  resolutionUnit?: string;
  chromaSubsampling?: string;
  isProgressive?: boolean;
  isPalette?: boolean;
  bitsPerSample?: number;
  pages?: number;
  pageHeight?: number;
  loop?: number;
  delay?: number[];
  background?: { r: number; g: number; b: number } | { gray: number };
  orientation?: number;
  hasProfile: boolean;
  hasAlpha: boolean;
  exif?: ExifData;
  stats?: Stats;
  thumbhash?: string;
}

export interface Stats {
  isOpaque: boolean;
  entropy: number;
  sharpness: number;
  dominant: { r: number; g: number; b: number };
  channels: object[];
}

export interface ExifData {
  // Camera info
  make?: string;
  model?: string;
  software?: string;
  lens_make?: string;
  lens_model?: string;
  lens_serial?: string;
  body_serial?: string;
  unique_id?: string;

  // Capture settings
  datetime?: string;
  orientation?: string;
  exposure_time?: number;
  f_number?: number;
  focal_length?: number;
  focal_length_35mm?: number;
  iso?: number;
  flash?: string;
  exposure_program?: string;
  exposure_compensation?: number;
  metering_mode?: string;
  white_balance?: string;
  color_space?: string;
  brightness?: number;
  max_aperture?: number;
  subject_distance?: number;
  light_source?: string;
  scene_capture_type?: string;
  contrast?: string;
  saturation?: string;
  sharpness?: string;
  digital_zoom?: number;

  // GPS
  latitude?: number;
  longitude?: number;
  altitude?: number;
  speed?: number;
  direction?: number;
  gps_timestamp?: string;

  // Metadata
  description?: string;
  artist?: string;
  copyright?: string;
  user_comment?: string;
  rating?: number;
}

export class HttpError extends Error {
  code: number;
  body?: Buffer | string;

  constructor(code: number, body?: Buffer | string) {
    super(typeof body === "string" ? body : `HTTP Error ${code}`);
    this.name = "HttpError";
    this.code = code;
    this.body = body;
  }
}

// Pipeline configuration
export interface PipelineConfig {
  url?: string; // For JSON requests (requires enableFetch)
  metadata?: { exif?: boolean; stats?: boolean; thumbhash?: boolean };
  tasks: PipelineTask[];
}

export interface PipelineTask {
  id: string;
  transform: {
    format: ImageType;
    width?: number;
    height?: number;
    quality?: number;
    blur?: boolean | number;
    greyscale?: boolean;
    lossless?: boolean;
    progressive?: boolean;
    effort?: number;
    fit?: ImageFit;
    kernel?: ImageKernel;
    position?: ImagePosition;
    preset?: ImagePreset;
  };
  output: S3Output;
}

export interface S3Output {
  bucket: string;
  key: string;
  acl?: string;
  contentType?: string;
}

// Pipeline response
export interface PipelineResponse {
  totalDurationMs: number;
  metadata?: MetadataResult;
  tasks: TaskResult[];
}

export interface TaskResult {
  id: string;
  status: "success" | "failed";
  durationMs: number;
  output?: {
    format: ImageType;
    width: number;
    height: number;
    size: number;
    url: string;
  };
  error?: string;
}

// S3 configuration (parsed from environment)
export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint?: string;
}
