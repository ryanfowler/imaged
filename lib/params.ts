import { CropType, ImageOptions, ImageType } from "./types";

const cropParams: { [key: string]: CropType | undefined } = {
  attention: CropType.Attention,
  center: CropType.Centre,
  centre: CropType.Centre,
  entropy: CropType.Entropy,
};

const formatParams: { [key: string]: ImageType | undefined } = {
  jpeg: ImageType.Jpeg,
  jpg: ImageType.Jpeg,
  png: ImageType.Png,
  tiff: ImageType.Tiff,
  webp: ImageType.WebP,
};

const getNumberParam = (
  params: URLSearchParams,
  key: string
): number | undefined => {
  const value = params.get(key);
  if (!value) {
    return;
  }
  try {
    return parseInt(value, 10);
  } catch {
    throw new Error(`${key} must be a valid integer`);
  }
};

const getBooleanParam = (
  params: URLSearchParams,
  key: string
): boolean | undefined => {
  const value = params.get(key);
  if (typeof value === "string") {
    return value !== "false" && value !== "0";
  }
};

const autoFormat = (accept: string): ImageType => {
  if (accept.match(/(^|\W)image\/webp($|\W)/)) {
    return ImageType.WebP;
  }
  return ImageType.Jpeg;
};

export const parseImageParams = (
  params: URLSearchParams,
  accept: string
): ImageOptions => {
  const blur = getNumberParam(params, "blur");
  if (typeof blur === "number" && (blur < 0 || blur > 100)) {
    throw new Error("blur must be between 0 and 1000");
  }

  let crop: CropType | undefined;
  const cropValue = params.get("crop");
  if (cropValue) {
    crop = cropParams[cropValue];
  }

  let format: ImageType | undefined;
  const formatValue = params.get("format");
  if (formatValue === "auto") {
    format = autoFormat(accept);
  } else if (formatValue) {
    format = formatParams[formatValue];
  }

  const height = getNumberParam(params, "height");
  if (height && height < 0) {
    throw new Error("height cannot be negative");
  }

  const lossless = getBooleanParam(params, "lossless");

  const progressive = getBooleanParam(params, "progressive");

  const quality = getNumberParam(params, "quality");
  if (quality && (quality < 1 || quality > 100)) {
    throw new Error("quality must be between 1 and 100");
  }

  const width = getNumberParam(params, "width");
  if (width && width < 0) {
    throw new Error("width cannot be negative");
  }

  return {
    blur,
    crop,
    format: format ?? ImageType.Jpeg,
    height,
    lossless,
    progressive,
    quality: quality ?? 75,
    width,
  };
};
