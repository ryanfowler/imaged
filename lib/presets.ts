import { ImageType, type ImagePreset, type PresetOptions } from "./types";

export function getPreset(
  imgType: ImageType,
  maybePreset?: ImagePreset,
): PresetOptions {
  const preset: ImagePreset = maybePreset || "auto";
  switch (imgType) {
    case ImageType.Avif:
      return AVIF_PRESETS[preset];
    case ImageType.Heic:
      return HEIC_PRESETS[preset];
    case ImageType.Jpeg:
      return JPEG_PRESETS[preset];
    case ImageType.JpegXL:
      return JPEG_PRESETS[preset];
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
  auto: {
    quality: 50,
    effort: 4,
    chromaSubsampling: "4:2:0",
  },
  fast: {
    quality: 50,
    effort: 2,
    chromaSubsampling: "4:2:0",
  },
  quality: {
    quality: 60,
    effort: 6,
    chromaSubsampling: "4:4:4",
  },
  size: {
    quality: 45,
    effort: 6,
    chromaSubsampling: "4:2:0",
  },
};

const HEIC_PRESETS = {
  auto: {
    quality: 50,
    effort: 4,
    chromaSubsampling: "4:2:0",
  },
  fast: {
    quality: 50,
    effort: 2,
    chromaSubsampling: "4:2:0",
  },
  quality: {
    quality: 60,
    effort: 6,
    chromaSubsampling: "4:4:4",
  },
  size: {
    quality: 45,
    effort: 6,
    chromaSubsampling: "4:2:0",
  },
};

const JPEG_PRESETS: PresetValues = {
  auto: {
    quality: 80,
    progressive: true,
    chromaSubsampling: "4:2:0",
    mozjpeg: false,
  },
  fast: {
    quality: 75,
    progressive: false, // slightly faster encode
    chromaSubsampling: "4:2:0",
    mozjpeg: false, // avoid extra work
  },
  quality: {
    quality: 88,
    progressive: true,
    chromaSubsampling: "4:4:4",
    mozjpeg: false, // keep “quality-first” semantics simple
  },
  size: {
    quality: 75,
    progressive: true,
    chromaSubsampling: "4:2:0",
    mozjpeg: true,
  },
};

const JXL_PRESETS = {
  auto: {
    quality: 80,
    effort: 6,
    decodingTier: 2,
  },
  fast: {
    quality: 80,
    effort: 3,
    decodingTier: 4,
  },
  quality: {
    quality: 90,
    effort: 7,
    decodingTier: 0,
  },
  size: {
    quality: 75,
    effort: 7,
    decodingTier: 0,
  },
};

const PNG_PRESETS = {
  auto: {
    compressionLevel: 6,
    adaptiveFiltering: true,
    palette: false,
  },
  fast: {
    compressionLevel: 2,
    adaptiveFiltering: false,
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
  auto: {
    compression: "lzw",
    predictor: "horizontal",
  },
  fast: {
    compression: "none",
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
  auto: {
    quality: 80,
    effort: 4,
    smartSubsample: true,
  },
  fast: {
    quality: 75,
    effort: 2,
    smartSubsample: false,
  },
  quality: {
    quality: 86,
    effort: 5,
    smartSubsample: true,
    smartDeblock: true, // can help low-contrast edges (slow)
  },
  size: {
    quality: 72,
    effort: 5,
    smartSubsample: true,
    alphaQuality: 80,
  },
};
