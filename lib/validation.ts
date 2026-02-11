import {
  HttpError,
  IMAGE_PRESETS,
  ImageFit,
  ImageKernel,
  ImagePosition,
  ImageType,
  type TransformOptions,
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
  failFast: boolean;
  fromString: boolean;
  prefix: string;
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

// Allowed content types for S3 uploads
const ALLOWED_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/jxl",
  "image/png",
  "image/svg+xml",
  "image/tiff",
  "image/webp",
  "application/pdf",
  "application/octet-stream",
]);

// Validate that a content type is an allowed image MIME type.
// Returns the validated content type, or throws HttpError for disallowed types.
export function validateContentType(contentType: string, prefix: string): string {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HttpError(400, `${prefix}: content type '${contentType}' is not allowed`);
  }
  return contentType;
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
// Unified field resolution - replaces all lenient/strict wrappers
// ============================================================================

function resolveField<T>(
  result: ValidationResult<T>,
  key: string,
  rawValue: unknown,
  ctx: ParseContext,
): T | undefined {
  if (result.ok === false) {
    if (ctx.failFast) {
      throw new HttpError(400, `${ctx.prefix}${key}: ${result.error}`);
    }
    addWarning(ctx, key, String(rawValue ?? ""), result.error);
    return undefined;
  }
  if ("warning" in result) {
    if (ctx.failFast) {
      throw new HttpError(400, `${ctx.prefix}${key}: ${result.warning}`);
    }
    addWarning(ctx, key, String(rawValue ?? ""), result.warning);
  }
  return result.value;
}

// ============================================================================
// Shared parsers - used by both server.ts and pipeline.ts
// ============================================================================

export function validateFormat(value: unknown, ctx: ParseContext): ImageType {
  if (typeof value !== "string") {
    throw new HttpError(400, `${ctx.prefix}format: must be a string`);
  }
  const normalized = normalizeFormat(value);
  if (!IMAGE_TYPE_SET.has(normalized)) {
    throw new HttpError(
      400,
      `${ctx.prefix}format: unknown format '${value}', valid: ${VALID_FORMATS}`,
    );
  }
  return normalized as ImageType;
}

export function parseTransformOptions(
  input: Record<string, unknown>,
  format: ImageType,
  ctx: ParseContext,
): TransformOptions {
  return {
    format,
    width: resolveField(
      validateDimensionCore(input["width"], ctx.dimensionLimit, ctx.fromString),
      "width",
      input["width"],
      ctx,
    ),
    height: resolveField(
      validateDimensionCore(input["height"], ctx.dimensionLimit, ctx.fromString),
      "height",
      input["height"],
      ctx,
    ),
    quality: resolveField(
      validateQualityCore(input["quality"], ctx.fromString),
      "quality",
      input["quality"],
      ctx,
    ),
    blur: resolveField(
      validateBlurCore(input["blur"], ctx.fromString),
      "blur",
      input["blur"],
      ctx,
    ),
    greyscale: resolveField(
      validateBooleanCore(input["greyscale"], ctx.fromString),
      "greyscale",
      input["greyscale"],
      ctx,
    ),
    lossless: resolveField(
      validateBooleanCore(input["lossless"], ctx.fromString),
      "lossless",
      input["lossless"],
      ctx,
    ),
    progressive: resolveField(
      validateBooleanCore(input["progressive"], ctx.fromString),
      "progressive",
      input["progressive"],
      ctx,
    ),
    effort: resolveField(
      validateEffortCore(input["effort"], format, ctx.fromString),
      "effort",
      input["effort"],
      ctx,
    ),
    fit: resolveField(
      validateEnumCore(input["fit"], IMAGE_FIT_SET, VALID_FITS, ctx.fromString),
      "fit",
      input["fit"],
      ctx,
    ),
    kernel: resolveField(
      validateEnumCore(
        input["kernel"],
        IMAGE_KERNEL_SET,
        VALID_KERNELS,
        ctx.fromString,
      ),
      "kernel",
      input["kernel"],
      ctx,
    ),
    position: resolveField(
      validateEnumCore(
        input["position"],
        IMAGE_POSITION_SET,
        VALID_POSITIONS,
        ctx.fromString,
      ),
      "position",
      input["position"],
      ctx,
    ),
    preset: resolveField(
      validateEnumCore(
        input["preset"],
        IMAGE_PRESET_SET,
        VALID_PRESETS,
        ctx.fromString,
      ),
      "preset",
      input["preset"],
      ctx,
    ),
  };
}

export function parseMetadataFlags(
  input: Record<string, unknown>,
  ctx: ParseContext,
): { exif: boolean; stats: boolean; thumbhash: boolean } {
  return {
    exif:
      resolveField(
        validateBooleanCore(input["exif"], ctx.fromString),
        "exif",
        input["exif"],
        ctx,
      ) ?? false,
    stats:
      resolveField(
        validateBooleanCore(input["stats"], ctx.fromString),
        "stats",
        input["stats"],
        ctx,
      ) ?? false,
    thumbhash:
      resolveField(
        validateBooleanCore(input["thumbhash"], ctx.fromString),
        "thumbhash",
        input["thumbhash"],
        ctx,
      ) ?? false,
  };
}
