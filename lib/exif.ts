import type { ExifData } from "./types.ts";

import exifReader from "exif-reader";

export function getExif(raw: Buffer): ExifData {
  const data = exifReader(raw);

  return {
    // Camera info
    make: data.Image?.Make,
    model: data.Image?.Model,
    software: data.Image?.Software,
    lens_make: data.Photo?.LensMake,
    lens_model: data.Photo?.LensModel,
    lens_serial: data.Photo?.LensSerialNumber,
    body_serial: getString(
      data.Photo?.BodySerialNumber ?? data.Image?.["SerialNumber"],
    ),
    unique_id: data.Photo?.ImageUniqueID,

    // Capture settings
    datetime: getDate(data),
    orientation: getOrientationStr(data.Image?.Orientation),
    exposure_time: getNumber(data.Photo?.ExposureTime),
    f_number: getNumber(data.Photo?.FNumber),
    focal_length: getNumber(data.Photo?.FocalLength),
    focal_length_35mm: getNumber(data.Photo?.FocalLengthIn35mmFilm),
    iso: getNumber(data.Photo?.ISOSpeedRatings ?? data.Image?.ISOSpeedRatings),
    flash: getFlashStr(data.Photo?.Flash),
    exposure_program: getExposureProgramStr(data.Photo?.ExposureProgram),
    exposure_compensation: getNumber(data.Photo?.ExposureBiasValue),
    metering_mode: getMeteringModeStr(data.Photo?.MeteringMode),
    white_balance: getWhiteBalanceStr(data.Photo?.WhiteBalance),
    color_space: getColorSpaceStr(data.Photo?.ColorSpace),
    brightness: getNumber(data.Photo?.BrightnessValue),
    max_aperture: getNumber(data.Photo?.MaxApertureValue),
    subject_distance: getNumber(data.Photo?.SubjectDistance),
    light_source: getLightSourceStr(data.Photo?.LightSource),
    scene_capture_type: getSceneCaptureTypeStr(data.Photo?.SceneCaptureType),
    contrast: getContrastStr(data.Photo?.Contrast),
    saturation: getSaturationStr(data.Photo?.Saturation),
    sharpness: getSharpnessStr(data.Photo?.Sharpness),
    digital_zoom: getDigitalZoom(data.Photo?.DigitalZoomRatio),

    // GPS
    latitude: getLatitude(data),
    longitude: getLongitude(data),
    altitude: getAltitude(data),
    speed: getSpeed(data),
    direction: getDirection(data),
    gps_timestamp: getGpsTimestamp(data),

    // Metadata
    description: data.Image?.ImageDescription,
    artist: data.Image?.Artist,
    copyright: data.Image?.Copyright,
    user_comment: getUserComment(data.Photo?.UserComment),
    rating: getRating(data.Image?.Rating),
  };
}

function getNumber(val?: number): number | undefined {
  if (typeof val !== "number" || !Number.isFinite(val)) {
    return undefined;
  }
  return val;
}

function getString(val?: unknown): string | undefined {
  if (typeof val === "string") {
    return val.length > 0 ? val : undefined;
  }
  if (typeof val === "number") {
    return String(val);
  }
  return undefined;
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

  // Validate all array elements are finite numbers
  const [deg, min, sec] = val;
  if (
    typeof deg !== "number" ||
    typeof min !== "number" ||
    typeof sec !== "number" ||
    !Number.isFinite(deg) ||
    !Number.isFinite(min) ||
    !Number.isFinite(sec)
  ) {
    return undefined;
  }

  let coord = deg + min / 60 + sec / 3600;

  if (ref === "S" || ref === "W") {
    coord = -coord;
  }

  return roundTo7(coord);
}

function roundTo7(n: number): number {
  return Number(Math.round((n + Number.EPSILON) * 1e7) / 1e7);
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

  // Validate offset format matches EXIF spec: +HH:MM or -HH:MM
  if (!/^[+-]\d{2}:\d{2}$/.test(offset)) {
    return dateStr;
  }

  // Remove the trailing 'Z' and append the offset.
  return dateStr.slice(0, -1) + offset;
}

function getAltitude(data: exifReader.Exif): number | undefined {
  const alt = data.GPSInfo?.GPSAltitude;
  if (typeof alt !== "number" || !Number.isFinite(alt)) {
    return undefined;
  }

  // GPSAltitudeRef: 0 = above sea level, 1 = below sea level
  const ref = data.GPSInfo?.GPSAltitudeRef;
  if (ref === 1) {
    return roundTo2(-alt);
  }
  return roundTo2(alt);
}

function getSpeed(data: exifReader.Exif): number | undefined {
  const speed = data.GPSInfo?.GPSSpeed;
  if (typeof speed !== "number" || !Number.isFinite(speed)) {
    return undefined;
  }

  // Convert to km/h based on GPSSpeedRef: K = km/h, M = mph, N = knots
  const ref = data.GPSInfo?.GPSSpeedRef;
  let kmh = speed;
  if (ref === "M") {
    kmh = speed * 1.60934; // mph to km/h
  } else if (ref === "N") {
    kmh = speed * 1.852; // knots to km/h
  }

  return roundTo2(kmh);
}

function getDirection(data: exifReader.Exif): number | undefined {
  // GPSImgDirection is the direction the camera was facing (compass heading)
  const dir = data.GPSInfo?.GPSImgDirection;
  if (typeof dir !== "number" || !Number.isFinite(dir)) {
    return undefined;
  }

  // Direction is in degrees (0-360), GPSImgDirectionRef indicates true/magnetic north
  // We return the raw value regardless of reference
  return roundTo2(dir);
}

function roundTo2(n: number): number {
  return Number(Math.round((n + Number.EPSILON) * 1e2) / 1e2);
}

function getFlashStr(flash?: number): string | undefined {
  if (typeof flash !== "number") {
    return undefined;
  }

  // Flash is a bitmask - bit 0 indicates if flash fired
  const fired = (flash & 0x01) !== 0;
  const mode = (flash >> 3) & 0x03;

  if (mode === 2) {
    return "Off";
  }
  if (mode === 3) {
    return "Auto";
  }
  return fired ? "Fired" : "Did not fire";
}

function getExposureProgramStr(program?: number): string | undefined {
  if (typeof program !== "number") {
    return undefined;
  }

  switch (program) {
    case 0:
      return "Not defined";
    case 1:
      return "Manual";
    case 2:
      return "Normal program";
    case 3:
      return "Aperture priority";
    case 4:
      return "Shutter priority";
    case 5:
      return "Creative program";
    case 6:
      return "Action program";
    case 7:
      return "Portrait mode";
    case 8:
      return "Landscape mode";
    default:
      return undefined;
  }
}

function getMeteringModeStr(mode?: number): string | undefined {
  if (typeof mode !== "number") {
    return undefined;
  }

  switch (mode) {
    case 0:
      return "Unknown";
    case 1:
      return "Average";
    case 2:
      return "Center-weighted average";
    case 3:
      return "Spot";
    case 4:
      return "Multi-spot";
    case 5:
      return "Pattern";
    case 6:
      return "Partial";
    case 255:
      return "Other";
    default:
      return undefined;
  }
}

function getWhiteBalanceStr(wb?: number): string | undefined {
  if (typeof wb !== "number") {
    return undefined;
  }

  switch (wb) {
    case 0:
      return "Auto";
    case 1:
      return "Manual";
    default:
      return undefined;
  }
}

function getColorSpaceStr(cs?: number): string | undefined {
  if (typeof cs !== "number") {
    return undefined;
  }

  switch (cs) {
    case 1:
      return "sRGB";
    case 2:
      return "Adobe RGB";
    case 0xffff:
      return "Uncalibrated";
    default:
      return undefined;
  }
}

function getLightSourceStr(ls?: number): string | undefined {
  if (typeof ls !== "number") {
    return undefined;
  }

  switch (ls) {
    case 0:
      return "Unknown";
    case 1:
      return "Daylight";
    case 2:
      return "Fluorescent";
    case 3:
      return "Tungsten (incandescent)";
    case 4:
      return "Flash";
    case 9:
      return "Fine weather";
    case 10:
      return "Cloudy";
    case 11:
      return "Shade";
    case 12:
      return "Daylight fluorescent";
    case 13:
      return "Day white fluorescent";
    case 14:
      return "Cool white fluorescent";
    case 15:
      return "White fluorescent";
    case 16:
      return "Warm white fluorescent";
    case 17:
      return "Standard light A";
    case 18:
      return "Standard light B";
    case 19:
      return "Standard light C";
    case 20:
      return "D55";
    case 21:
      return "D65";
    case 22:
      return "D75";
    case 23:
      return "D50";
    case 24:
      return "ISO studio tungsten";
    case 255:
      return "Other";
    default:
      return undefined;
  }
}

function getSceneCaptureTypeStr(sct?: number): string | undefined {
  if (typeof sct !== "number") {
    return undefined;
  }

  switch (sct) {
    case 0:
      return "Standard";
    case 1:
      return "Landscape";
    case 2:
      return "Portrait";
    case 3:
      return "Night scene";
    default:
      return undefined;
  }
}

function getContrastStr(c?: number): string | undefined {
  if (typeof c !== "number") {
    return undefined;
  }

  switch (c) {
    case 0:
      return "Normal";
    case 1:
      return "Low";
    case 2:
      return "High";
    default:
      return undefined;
  }
}

function getSaturationStr(s?: number): string | undefined {
  if (typeof s !== "number") {
    return undefined;
  }

  switch (s) {
    case 0:
      return "Normal";
    case 1:
      return "Low";
    case 2:
      return "High";
    default:
      return undefined;
  }
}

function getSharpnessStr(s?: number): string | undefined {
  if (typeof s !== "number") {
    return undefined;
  }

  switch (s) {
    case 0:
      return "Normal";
    case 1:
      return "Soft";
    case 2:
      return "Hard";
    default:
      return undefined;
  }
}

function getDigitalZoom(ratio?: number): number | undefined {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) {
    return undefined;
  }
  // A ratio of 0 or 1 means no digital zoom was used
  if (ratio <= 1) {
    return undefined;
  }
  return roundTo2(ratio);
}

function getGpsTimestamp(data: exifReader.Exif): string | undefined {
  const date = data.GPSInfo?.GPSDateStamp;
  const time = data.GPSInfo?.GPSTimeStamp;

  if (!date || !time) {
    return undefined;
  }

  // GPSDateStamp format: "YYYY:MM:DD"
  // GPSTimeStamp format: [hours, minutes, seconds] as numbers
  if (typeof date !== "string" || !Array.isArray(time) || time.length !== 3) {
    return undefined;
  }

  const [hours, minutes, seconds] = time;
  if (
    typeof hours !== "number" ||
    typeof minutes !== "number" ||
    typeof seconds !== "number" ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return undefined;
  }

  // Convert "YYYY:MM:DD" to "YYYY-MM-DD"
  const datePart = date.replace(/:/g, "-");
  const timePart = [
    String(Math.floor(hours)).padStart(2, "0"),
    String(Math.floor(minutes)).padStart(2, "0"),
    String(Math.floor(seconds)).padStart(2, "0"),
  ].join(":");

  return `${datePart}T${timePart}Z`;
}

function getUserComment(comment?: string | Buffer): string | undefined {
  if (!comment) {
    return undefined;
  }

  // UserComment can be a string or a Buffer with encoding prefix
  if (typeof comment === "string") {
    const trimmed = comment.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  // Handle Buffer: first 8 bytes are encoding identifier
  if (Buffer.isBuffer(comment) && comment.length > 8) {
    const encoding = comment.subarray(0, 8).toString("ascii").trim();
    const content = comment.subarray(8);

    let decoded: string;
    if (encoding === "UNICODE" || encoding.startsWith("UNICODE")) {
      decoded = content.toString("utf16le");
    } else {
      decoded = content.toString("utf8");
    }

    // Remove null characters and trim
    const trimmed = decoded.replace(/\0/g, "").trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}

function getRating(rating?: number): number | undefined {
  if (typeof rating !== "number" || !Number.isInteger(rating)) {
    return undefined;
  }
  // Rating is typically 0-5 (0 = unrated, 1-5 = star rating)
  if (rating < 0 || rating > 5) {
    return undefined;
  }
  // Don't return 0 (unrated)
  if (rating === 0) {
    return undefined;
  }
  return rating;
}
