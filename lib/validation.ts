import {
  HttpError,
  IMAGE_PRESETS,
  ImageFit,
  ImageKernel,
  ImagePosition,
  type ImagePreset,
  ImageType,
} from "./types.ts";

// ============================================================================
// Result types for core validators
// ============================================================================

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: true; value: T; warning: string }
  | { ok: false; error: string };

// Helper to create success result
function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

// Helper to create success result with warning (clamped value)
function okWithWarning<T>(value: T, warning: string): ValidationResult<T> {
  return { ok: true, value, warning };
}

// Helper to create error result
function err<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

// ============================================================================
// Parse context for lenient validation (used by server.ts)
// ============================================================================

export interface ParseWarning {
  param: string;
  value: string;
  reason: string;
}

export interface ParseContext {
  strict: boolean;
  warnings: ParseWarning[];
  dimensionLimit: number;
}

export function addWarning(
  ctx: ParseContext,
  param: string,
  value: string,
  reason: string,
): void {
  ctx.warnings.push({ param, value, reason });
}

// ============================================================================
// Shared constants
export const IMAGE_TYPE_SET = new Set<string>(Object.values(ImageType));
export const IMAGE_FIT_SET = new Set<string>(Object.values(ImageFit));
export const IMAGE_KERNEL_SET = new Set<string>(Object.values(ImageKernel));
export const IMAGE_POSITION_SET = new Set<string>(Object.values(ImagePosition));
export const IMAGE_PRESET_SET = new Set<string>(IMAGE_PRESETS);

export const VALID_FORMATS = Object.values(ImageType).join(", ");
export const VALID_FITS = Object.values(ImageFit).join(", ");
export const VALID_KERNELS = Object.values(ImageKernel).join(", ");
export const VALID_POSITIONS = Object.values(ImagePosition).join(", ");
export const VALID_PRESETS = IMAGE_PRESETS.join(", ");

// Effort ranges by format
export function getEffortRange(
  format: ImageType,
): { low: number; high: number } | null {
  switch (format) {
    case ImageType.Avif:
    case ImageType.Heic:
      return { low: 0, high: 9 };
    case ImageType.Gif:
    case ImageType.Png:
      return { low: 1, high: 10 };
    case ImageType.JpegXL:
      return { low: 1, high: 9 };
    case ImageType.Webp:
      return { low: 0, high: 6 };
    default:
      return null;
  }
}

// Normalize format string (handle aliases like jpg -> jpeg)
export function normalizeFormat(value: string): string {
  const v = value.toLowerCase();
  if (v === "jpg") return "jpeg";
  if (v === "tif") return "tiff";
  return v;
}

// Get mime type for image format
export function getMimetype(format: ImageType): string {
  switch (format) {
    case ImageType.Avif:
      return "image/avif";
    case ImageType.Gif:
      return "image/gif";
    case ImageType.Heic:
      return "image/heic";
    case ImageType.Jpeg:
      return "image/jpeg";
    case ImageType.JpegXL:
      return "image/jxl";
    case ImageType.Png:
      return "image/png";
    case ImageType.Pdf:
      return "application/pdf";
    case ImageType.Raw:
      return "application/octet-stream";
    case ImageType.Svg:
      return "image/svg+xml";
    case ImageType.Tiff:
      return "image/tiff";
    case ImageType.Webp:
      return "image/webp";
  }
}

// ============================================================================
// String parsing helpers
// ============================================================================

// Parse an integer from a string (used by lenient validators)
function parseIntegerFromString(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (!Number.isInteger(n)) {
    return null;
  }
  if (n < 0 || n > 0xffff_ffff) {
    return null;
  }
  return n;
}

// Parse a number (possibly float) from a string
function parseNumberFromString(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

// ============================================================================
// Core validators - return ValidationResult, contain all validation logic once
// ============================================================================

export function validateBooleanCore(
  value: unknown,
  fromString: boolean,
): ValidationResult<boolean | undefined> {
  if (value === undefined || value === null) {
    return ok(undefined);
  }

  if (fromString) {
    const v = value as string;
    if (v === "false" || v === "0") {
      return ok(false);
    }
    if (v === "" || v === "true" || v === "1") {
      return ok(true);
    }
    // Invalid string value - treat as true with warning
    return okWithWarning(true, "must be true, false, 1, or 0");
  }

  if (typeof value !== "boolean") {
    return err("must be a boolean");
  }
  return ok(value);
}

export function validateQualityCore(
  value: unknown,
  fromString: boolean,
): ValidationResult<number | undefined> {
  if (value === undefined || value === null || value === "") {
    return ok(undefined);
  }

  let num: number;
  if (fromString) {
    const parsed = parseIntegerFromString(value as string);
    if (parsed === null) {
      return err("must be a positive integer");
    }
    num = parsed;
  } else {
    if (typeof value !== "number") {
      return err("must be a number");
    }
    if (!Number.isInteger(value)) {
      return err("must be an integer");
    }
    num = value;
  }

  if (num < 1) {
    return okWithWarning(1, "must be at least 1");
  }
  if (num > 100) {
    return okWithWarning(100, "must be at most 100");
  }
  return ok(num);
}

export function validateBlurCore(
  value: unknown,
  fromString: boolean,
): ValidationResult<boolean | number | undefined> {
  if (value === undefined || value === null) {
    return ok(undefined);
  }

  if (fromString) {
    const v = value as string;
    if (v === "false" || v === "0") {
      return ok(undefined);
    }
    if (v === "" || v === "true" || v === "1") {
      return ok(true);
    }
    const n = parseNumberFromString(v);
    if (n === null) {
      return err("must be a boolean or number between 0.3 and 1000");
    }
    if (n < 0.3) {
      return okWithWarning(0.3, "must be at least 0.3");
    }
    if (n > 1000) {
      return okWithWarning(1000, "must be at most 1000");
    }
    return ok(n);
  }

  // JSON/typed value
  if (typeof value === "boolean") {
    return ok(value ? true : undefined);
  }
  if (typeof value !== "number") {
    return err("must be a boolean or number between 0.3 and 1000");
  }
  if (!Number.isFinite(value)) {
    return err("must be a boolean or number between 0.3 and 1000");
  }
  if (value < 0.3) {
    return okWithWarning(0.3, "must be at least 0.3");
  }
  if (value > 1000) {
    return okWithWarning(1000, "must be at most 1000");
  }
  return ok(value);
}

export function validateDimensionCore(
  value: unknown,
  _key: string,
  limit: number,
  fromString: boolean,
): ValidationResult<number | undefined> {
  if (value === undefined || value === null || value === "") {
    return ok(undefined);
  }

  let num: number;
  if (fromString) {
    const parsed = parseIntegerFromString(value as string);
    if (parsed === null) {
      return err("must be a positive integer");
    }
    num = parsed;
  } else {
    if (typeof value !== "number") {
      return err("must be a number");
    }
    if (!Number.isInteger(value)) {
      return err("must be an integer");
    }
    num = value;
  }

  if (num < 1) {
    return okWithWarning(1, "must be at least 1");
  }
  if (num > limit) {
    return okWithWarning(limit, `must be at most ${limit}`);
  }
  return ok(num);
}

export function validateEffortCore(
  value: unknown,
  format: ImageType,
  fromString: boolean,
): ValidationResult<number | undefined> {
  if (value === undefined || value === null || value === "") {
    return ok(undefined);
  }

  let num: number;
  if (fromString) {
    const parsed = parseIntegerFromString(value as string);
    if (parsed === null) {
      return err("must be a positive integer");
    }
    num = parsed;
  } else {
    if (typeof value !== "number") {
      return err("must be a number");
    }
    if (!Number.isInteger(value)) {
      return err("must be an integer");
    }
    num = value;
  }

  const range = getEffortRange(format);
  if (!range) {
    // effort not applicable for this format
    return ok(undefined);
  }

  if (num < range.low) {
    return okWithWarning(range.low, `must be at least ${range.low} for ${format}`);
  }
  if (num > range.high) {
    return okWithWarning(range.high, `must be at most ${range.high} for ${format}`);
  }
  return ok(num);
}

export function validateEnumCore<T extends string>(
  value: unknown,
  validSet: Set<string>,
  validList: string,
  fromString: boolean,
): ValidationResult<T | undefined> {
  if (value === undefined || value === null || value === "") {
    return ok(undefined);
  }

  if (!fromString && typeof value !== "string") {
    return err("must be a string");
  }

  const v = value as string;
  if (!validSet.has(v)) {
    return err(`unknown value '${v}', valid: ${validList}`);
  }
  return ok(v as T);
}

// ============================================================================
// Lenient wrappers (for server.ts) - collect warnings + return clamped values
// ============================================================================

export function parseBooleanLenient(
  value: string | undefined,
  key: string,
  ctx: ParseContext,
): boolean | undefined {
  const result = validateBooleanCore(value, true);
  if (result.ok === false) {
    addWarning(ctx, key, value ?? "", result.error);
    return undefined;
  }
  if ("warning" in result) {
    addWarning(ctx, key, value ?? "", result.warning);
  }
  return result.value;
}

export function parseQualityLenient(
  value: string | undefined,
  ctx: ParseContext,
): number | undefined {
  const result = validateQualityCore(value, true);
  if (result.ok === false) {
    addWarning(ctx, "quality", value ?? "", result.error);
    return undefined;
  }
  if ("warning" in result) {
    addWarning(ctx, "quality", value ?? "", result.warning);
  }
  return result.value;
}

export function parseBlurLenient(
  value: string | undefined,
  ctx: ParseContext,
): boolean | number | undefined {
  const result = validateBlurCore(value, true);
  if (result.ok === false) {
    addWarning(ctx, "blur", value ?? "", result.error);
    return undefined;
  }
  if ("warning" in result) {
    addWarning(ctx, "blur", value ?? "", result.warning);
  }
  return result.value;
}

export function parseDimensionLenient(
  value: string | undefined,
  key: string,
  ctx: ParseContext,
): number | undefined {
  const result = validateDimensionCore(value, key, ctx.dimensionLimit, true);
  if (result.ok === false) {
    addWarning(ctx, key, value ?? "", result.error);
    return undefined;
  }
  if ("warning" in result) {
    addWarning(ctx, key, value ?? "", result.warning);
  }
  return result.value;
}

export function parseEffortLenient(
  value: string | undefined,
  format: ImageType,
  ctx: ParseContext,
): number | undefined {
  const result = validateEffortCore(value, format, true);
  if (result.ok === false) {
    addWarning(ctx, "effort", value ?? "", result.error);
    return undefined;
  }
  if ("warning" in result) {
    addWarning(ctx, "effort", value ?? "", result.warning);
  }
  return result.value;
}

export function parseFitLenient(
  value: string | undefined,
  ctx: ParseContext,
): ImageFit | undefined {
  const result = validateEnumCore<ImageFit>(value, IMAGE_FIT_SET, VALID_FITS, true);
  if (result.ok === false) {
    addWarning(ctx, "fit", value ?? "", result.error);
    return undefined;
  }
  return result.value;
}

export function parseKernelLenient(
  value: string | undefined,
  ctx: ParseContext,
): ImageKernel | undefined {
  const result = validateEnumCore<ImageKernel>(
    value,
    IMAGE_KERNEL_SET,
    VALID_KERNELS,
    true,
  );
  if (result.ok === false) {
    addWarning(ctx, "kernel", value ?? "", result.error);
    return undefined;
  }
  return result.value;
}

export function parsePositionLenient(
  value: string | undefined,
  ctx: ParseContext,
): ImagePosition | undefined {
  const result = validateEnumCore<ImagePosition>(
    value,
    IMAGE_POSITION_SET,
    VALID_POSITIONS,
    true,
  );
  if (result.ok === false) {
    addWarning(ctx, "position", value ?? "", result.error);
    return undefined;
  }
  return result.value;
}

export function parsePresetLenient(
  value: string | undefined,
  ctx: ParseContext,
): ImagePreset | undefined {
  const result = validateEnumCore<ImagePreset>(
    value,
    IMAGE_PRESET_SET,
    VALID_PRESETS,
    true,
  );
  if (result.ok === false) {
    addWarning(ctx, "preset", value ?? "", result.error);
    return undefined;
  }
  return result.value;
}

// ============================================================================
// Strict validators (for pipeline.ts) - throw HttpError on invalid input
// These accept typed values (from JSON) and a field prefix for error messages
// ============================================================================

export function validateFormatStrict(value: unknown, prefix: string): ImageType {
  if (typeof value !== "string") {
    throw new HttpError(400, `${prefix}.format: must be a string`);
  }
  const normalized = normalizeFormat(value);
  if (!IMAGE_TYPE_SET.has(normalized)) {
    throw new HttpError(
      400,
      `${prefix}.format: unknown format '${value}', valid: ${VALID_FORMATS}`,
    );
  }
  return normalized as ImageType;
}

export function validateDimensionStrict(
  value: unknown,
  key: string,
  prefix: string,
  dimensionLimit: number,
): number | undefined {
  const result = validateDimensionCore(value, key, dimensionLimit, false);
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.${key}: ${result.error}`);
  }
  if ("warning" in result) {
    throw new HttpError(400, `${prefix}.${key}: ${result.warning}`);
  }
  return result.value;
}

export function validateQualityStrict(
  value: unknown,
  prefix: string,
): number | undefined {
  const result = validateQualityCore(value, false);
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.quality: ${result.error}`);
  }
  if ("warning" in result) {
    throw new HttpError(400, `${prefix}.quality: ${result.warning}`);
  }
  return result.value;
}

export function validateBlurStrict(
  value: unknown,
  prefix: string,
): boolean | number | undefined {
  const result = validateBlurCore(value, false);
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.blur: ${result.error}`);
  }
  if ("warning" in result) {
    throw new HttpError(400, `${prefix}.blur: ${result.warning}`);
  }
  return result.value;
}

export function validateBooleanStrict(
  value: unknown,
  key: string,
  prefix: string,
): boolean | undefined {
  const result = validateBooleanCore(value, false);
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.${key}: ${result.error}`);
  }
  if ("warning" in result) {
    throw new HttpError(400, `${prefix}.${key}: ${result.warning}`);
  }
  return result.value;
}

export function validateEffortStrict(
  value: unknown,
  format: ImageType,
  prefix: string,
): number | undefined {
  const result = validateEffortCore(value, format, false);
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.effort: ${result.error}`);
  }
  if ("warning" in result) {
    throw new HttpError(400, `${prefix}.effort: ${result.warning}`);
  }
  return result.value;
}

export function validateFitStrict(
  value: unknown,
  prefix: string,
): ImageFit | undefined {
  const result = validateEnumCore<ImageFit>(value, IMAGE_FIT_SET, VALID_FITS, false);
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.fit: ${result.error}`);
  }
  return result.value;
}

export function validateKernelStrict(
  value: unknown,
  prefix: string,
): ImageKernel | undefined {
  const result = validateEnumCore<ImageKernel>(
    value,
    IMAGE_KERNEL_SET,
    VALID_KERNELS,
    false,
  );
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.kernel: ${result.error}`);
  }
  return result.value;
}

export function validatePositionStrict(
  value: unknown,
  prefix: string,
): ImagePosition | undefined {
  const result = validateEnumCore<ImagePosition>(
    value,
    IMAGE_POSITION_SET,
    VALID_POSITIONS,
    false,
  );
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.position: ${result.error}`);
  }
  return result.value;
}

export function validatePresetStrict(
  value: unknown,
  prefix: string,
): ImagePreset | undefined {
  const result = validateEnumCore<ImagePreset>(
    value,
    IMAGE_PRESET_SET,
    VALID_PRESETS,
    false,
  );
  if (result.ok === false) {
    throw new HttpError(400, `${prefix}.preset: ${result.error}`);
  }
  return result.value;
}
