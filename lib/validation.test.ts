import { describe, test, expect } from "bun:test";
import {
  type ParseContext,
  parseMetadataFlags,
  parseTransformOptions,
  validateFormat,
} from "./validation.ts";
import { HttpError, ImageType } from "./types.ts";

function createServerCtx(dimensionLimit = 16384): ParseContext {
  return {
    strict: false,
    failFast: false,
    fromString: true,
    prefix: "",
    warnings: [],
    dimensionLimit,
  };
}

function createPipelineCtx(index = 0, dimensionLimit = 16384): ParseContext {
  return {
    strict: false,
    failFast: true,
    fromString: false,
    prefix: `task[${index}].transform.`,
    warnings: [],
    dimensionLimit,
  };
}

describe("validateFormat", () => {
  test("validates known format", () => {
    const ctx = createPipelineCtx();
    expect(validateFormat("jpeg", ctx)).toBe("jpeg");
  });

  test("normalizes jpg to jpeg", () => {
    const ctx = createPipelineCtx();
    expect(validateFormat("jpg", ctx)).toBe("jpeg");
  });

  test("normalizes tif to tiff", () => {
    const ctx = createPipelineCtx();
    expect(validateFormat("tif", ctx)).toBe("tiff");
  });

  test("throws for unknown format with prefix", () => {
    const ctx = createPipelineCtx();
    try {
      validateFormat("bmp", ctx);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      const err = e as HttpError;
      expect(String(err.body)).toContain("task[0].transform.format:");
      expect(String(err.body)).toContain("unknown format 'bmp'");
    }
  });

  test("throws for non-string value with prefix", () => {
    const ctx = createPipelineCtx();
    try {
      validateFormat(123, ctx);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).body).toBe("task[0].transform.format: must be a string");
    }
  });

  test("uses empty prefix in server context", () => {
    const ctx = createServerCtx();
    try {
      validateFormat(123, ctx);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).body).toBe("format: must be a string");
    }
  });
});

describe("parseTransformOptions", () => {
  describe("server context (lenient, fromString)", () => {
    test("returns defaults for empty input", () => {
      const ctx = createServerCtx();
      const opts = parseTransformOptions({}, ImageType.Jpeg, ctx);
      expect(opts.format).toBe("jpeg");
      expect(opts.width).toBeUndefined();
      expect(opts.height).toBeUndefined();
      expect(opts.quality).toBeUndefined();
      expect(opts.blur).toBeUndefined();
      expect(opts.greyscale).toBeUndefined();
      expect(opts.lossless).toBeUndefined();
      expect(opts.progressive).toBeUndefined();
      expect(opts.effort).toBeUndefined();
      expect(opts.fit).toBeUndefined();
      expect(opts.kernel).toBeUndefined();
      expect(opts.position).toBeUndefined();
      expect(opts.preset).toBeUndefined();
      expect(ctx.warnings).toHaveLength(0);
    });

    test("parses string values", () => {
      const ctx = createServerCtx();
      const opts = parseTransformOptions(
        { width: "200", height: "150", quality: "80" },
        ImageType.Jpeg,
        ctx,
      );
      expect(opts.width).toBe(200);
      expect(opts.height).toBe(150);
      expect(opts.quality).toBe(80);
      expect(ctx.warnings).toHaveLength(0);
    });

    test("collects warnings for invalid values without throwing", () => {
      const ctx = createServerCtx();
      const opts = parseTransformOptions(
        { width: "abc", quality: "xyz" },
        ImageType.Jpeg,
        ctx,
      );
      expect(opts.width).toBeUndefined();
      expect(opts.quality).toBeUndefined();
      expect(ctx.warnings).toHaveLength(2);
      expect(ctx.warnings[0].param).toBe("width");
      expect(ctx.warnings[1].param).toBe("quality");
    });

    test("collects warnings for clamped values", () => {
      const ctx = createServerCtx(1000);
      const opts = parseTransformOptions(
        { width: "2000", quality: "200" },
        ImageType.Jpeg,
        ctx,
      );
      expect(opts.width).toBe(1000);
      expect(opts.quality).toBe(100);
      expect(ctx.warnings).toHaveLength(2);
    });
  });

  describe("pipeline context (failFast, typed values)", () => {
    test("throws immediately on invalid value", () => {
      const ctx = createPipelineCtx();
      try {
        parseTransformOptions({ width: -10 }, ImageType.Jpeg, ctx);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).body).toBe(
          "task[0].transform.width: must be at least 1",
        );
      }
    });

    test("throws on clamped value (treated as error in failFast mode)", () => {
      const ctx = createPipelineCtx(2, 1000);
      try {
        parseTransformOptions({ width: 2000 }, ImageType.Jpeg, ctx);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).body).toBe(
          "task[2].transform.width: must be at most 1000",
        );
      }
    });

    test("parses all fields with typed values", () => {
      const ctx = createPipelineCtx();
      const opts = parseTransformOptions(
        {
          width: 200,
          height: 150,
          quality: 85,
          blur: 5,
          greyscale: true,
          lossless: false,
          progressive: true,
          effort: 4,
          fit: "cover",
          kernel: "lanczos3",
          position: "center",
          preset: "quality",
        },
        ImageType.Webp,
        ctx,
      );
      expect(opts.format).toBe("webp");
      expect(opts.width).toBe(200);
      expect(opts.height).toBe(150);
      expect(opts.quality).toBe(85);
      expect(opts.blur).toBe(5);
      expect(opts.greyscale).toBe(true);
      expect(opts.lossless).toBe(false);
      expect(opts.progressive).toBe(true);
      expect(opts.effort).toBe(4);
      expect(opts.fit).toBe("cover");
      expect(opts.kernel).toBe("lanczos3");
      expect(opts.position).toBe("center");
      expect(opts.preset).toBe("quality");
    });
  });
});

describe("parseMetadataFlags", () => {
  test("defaults to false for all flags", () => {
    const ctx = createServerCtx();
    const flags = parseMetadataFlags({}, ctx);
    expect(flags.exif).toBe(false);
    expect(flags.stats).toBe(false);
    expect(flags.thumbhash).toBe(false);
  });

  test("parses string boolean flags in server context", () => {
    const ctx = createServerCtx();
    const flags = parseMetadataFlags(
      { exif: "true", stats: "1", thumbhash: "false" },
      ctx,
    );
    expect(flags.exif).toBe(true);
    expect(flags.stats).toBe(true);
    expect(flags.thumbhash).toBe(false);
    expect(ctx.warnings).toHaveLength(0);
  });

  test("collects warning for invalid value in server context", () => {
    const ctx = createServerCtx();
    const flags = parseMetadataFlags({ exif: "maybe" }, ctx);
    expect(flags.exif).toBe(true); // okWithWarning(true, ...)
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0].param).toBe("exif");
  });

  test("parses typed boolean flags in pipeline context", () => {
    const ctx: ParseContext = {
      strict: false,
      failFast: true,
      fromString: false,
      prefix: "task[0].metadata.",
      warnings: [],
      dimensionLimit: 16384,
    };
    const flags = parseMetadataFlags(
      { exif: true, stats: false, thumbhash: true },
      ctx,
    );
    expect(flags.exif).toBe(true);
    expect(flags.stats).toBe(false);
    expect(flags.thumbhash).toBe(true);
  });

  test("throws for invalid boolean in pipeline context with prefix", () => {
    const ctx: ParseContext = {
      strict: false,
      failFast: true,
      fromString: false,
      prefix: "task[0].metadata.",
      warnings: [],
      dimensionLimit: 16384,
    };
    try {
      parseMetadataFlags({ exif: "invalid" }, ctx);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).body).toBe("task[0].metadata.exif: must be a boolean");
    }
  });

  test("throws for non-boolean type in pipeline context", () => {
    const ctx: ParseContext = {
      strict: false,
      failFast: true,
      fromString: false,
      prefix: "task[1].metadata.",
      warnings: [],
      dimensionLimit: 16384,
    };
    try {
      parseMetadataFlags({ stats: 42 }, ctx);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).body).toBe("task[1].metadata.stats: must be a boolean");
    }
  });
});
