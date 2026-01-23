import { ImageType, type ImagePreset, type PresetOptions } from "./types";

export function getPreset(
  imgType: ImageType,
  maybePreset?: ImagePreset,
): PresetOptions {
  const preset: ImagePreset = maybePreset || "default";
  switch (imgType) {
    case ImageType.Avif:
      return AVIF_PRESETS[preset];
    case ImageType.Heic:
      return HEIC_PRESETS[preset];
    case ImageType.Jpeg:
      return JPEG_PRESETS[preset];
    case ImageType.JpegXL:
      return JXL_PRESETS[preset];
    case ImageType.Png:
      return PNG_PRESETS[preset];
    case ImageType.Tiff:
      return TIFF_PRESETS[preset];
    case ImageType.Webp:
      return WEBP_PRESETS[preset];
    default:
      return {};
  }
}

type PresetValues = Record<ImagePreset, PresetOptions>;

const AVIF_PRESETS = {
  default: {
    quality: 45,
    effort: 2,
    chromaSubsampling: "4:2:0",
  },
  quality: {
    quality: 60,
    effort: 6,
    chromaSubsampling: "4:4:4",
  },
  size: {
    quality: 40,
    effort: 6,
    chromaSubsampling: "4:2:0",
  },
};

const HEIC_PRESETS = {
  default: {
    quality: 45,
    effort: 2,
    chromaSubsampling: "4:2:0",
  },
  quality: {
    quality: 60,
    effort: 6,
    chromaSubsampling: "4:4:4",
  },
  size: {
    quality: 40,
    effort: 6,
    chromaSubsampling: "4:2:0",
  },
};

const JPEG_PRESETS: PresetValues = {
  default: {
    quality: 75,
    progressive: true,
    chromaSubsampling: "4:2:0",
    mozjpeg: false,
  },
  quality: {
    quality: 90,
    progressive: false,
    chromaSubsampling: "4:4:4",
    mozjpeg: false,
    optimiseCoding: false,
  },
  size: {
    quality: 70,
    progressive: true,
    chromaSubsampling: "4:2:0",
    mozjpeg: true,
  },
};

const JXL_PRESETS = {
  default: {
    quality: 75,
    effort: 3,
    decodingTier: 2,
  },
  quality: {
    quality: 90,
    effort: 7,
    decodingTier: 0,
  },
  size: {
    quality: 70,
    effort: 7,
    decodingTier: 0,
  },
};

const PNG_PRESETS = {
  default: {
    compressionLevel: 4,
    adaptiveFiltering: true,
    palette: false,
  },
  quality: {
    compressionLevel: 7,
    adaptiveFiltering: true,
    palette: false,
  },
  size: {
    compressionLevel: 9,
    adaptiveFiltering: true,
    palette: true,
    effort: 7,
    colours: 256,
  },
};

const TIFF_PRESETS = {
  default: {
    compression: "lzw",
    predictor: "horizontal",
  },
  quality: {
    compression: "lzw",
    predictor: "horizontal",
  },
  size: {
    compression: "jpeg",
    quality: 80,
  },
};

const WEBP_PRESETS = {
  default: {
    quality: 75,
    effort: 2,
    smartSubsample: true,
  },
  quality: {
    quality: 88,
    effort: 5,
    smartSubsample: true,
    smartDeblock: true,
  },
  size: {
    quality: 70,
    effort: 5,
    smartSubsample: true,
    alphaQuality: 80,
  },
};
