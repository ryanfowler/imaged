import type { ExifData } from "./types.ts";

import exifReader from "exif-reader";

export function getExif(raw: Buffer): ExifData {
  const data = exifReader(raw);

  return {
    make: data.Image?.Make,
    model: data.Image?.Model,
    software: data.Image?.Software,
    datetime: getDate(data),
    orientation: getOrientationStr(data.Image?.Orientation),
    f_number: data.Photo?.FNumber,
    iso: data.Image?.ISOSpeedRatings,
    lens_make: data.Photo?.LensMake,
    lens_model: data.Photo?.LensModel,
    latitude: getLatitude(data),
    longitude: getLongitude(data),
  };
}

function getOrientationStr(n?: number): string | undefined {
  if (n == null || typeof n === "undefined") {
    return undefined;
  }

  switch (n) {
    case 1:
      return "Horizontal (normal)";
    case 2:
      return "Mirror horizontal";
    case 3:
      return "Rotate 180";
    case 4:
      return "Mirror vertical";
    case 5:
      return "Mirror horizontal and rotate 270 CW";
    case 6:
      return "Rotate 90 CW";
    case 7:
      return "Mirror horizontal and rotate 90 CW";
    case 8:
      return "Rotate 270 CW";
    default:
      return undefined;
  }
}

function getLatitude(data: exifReader.Exif): number | undefined {
  return getCoordinate(data.GPSInfo?.GPSLatitude, data.GPSInfo?.GPSLatitudeRef);
}

function getLongitude(data: exifReader.Exif): number | undefined {
  return getCoordinate(data.GPSInfo?.GPSLongitude, data.GPSInfo?.GPSLongitudeRef);
}

function getCoordinate(val?: number[], ref?: string): number | undefined {
  if (val == null || typeof val === "undefined") {
    return undefined;
  }
  if (val.length !== 3) {
    return undefined;
  }

  let coord = (val[0] as number) + (val[1] as number) / 60 + (val[2] as number) / 3600;

  if (ref === "S" || ref === "W") {
    coord = -coord;
  }

  return roundTo5(coord);
}

function roundTo5(n: number): number {
  return Number(Math.round((n + Number.EPSILON) * 1e5) / 1e5);
}

function getDate(data: exifReader.Exif): string | undefined {
  const date = data.Photo?.DateTimeOriginal || data.Photo?.DateTimeDigitized;
  if (!date) {
    return undefined;
  }

  const dateStr = date.toISOString();
  const offset = data.Photo?.OffsetTime || data.Photo?.OffsetTimeOriginal;
  if (!offset) {
    return dateStr;
  }

  // Remove the trailing 'Z' and append the offset.
  return dateStr.slice(0, -1) + offset;
}
