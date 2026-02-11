import { describe, test, expect } from "bun:test";
import { createParseContext, parseImageOps, parseMetadataOps } from "./server.ts";
import { ImageType, ImageFit, ImageKernel, ImagePosition } from "./types.ts";
import { HttpError } from "./types.ts";

const DEFAULT_DIMENSION_LIMIT = 16384;

describe("createParseContext", () => {
  test("creates context with strict=false by default", () => {
    const ctx = createParseContext({}, DEFAULT_DIMENSION_LIMIT);
    expect(ctx.strict).toBe(false);
    expect(ctx.warnings).toEqual([]);
    expect(ctx.dimensionLimit).toBe(DEFAULT_DIMENSION_LIMIT);
  });

  test("creates context with strict=true when strict=true", () => {
    const ctx = createParseContext({ strict: "true" }, DEFAULT_DIMENSION_LIMIT);
    expect(ctx.strict).toBe(true);
  });

  test("creates context with strict=true when strict=1", () => {
    const ctx = createParseContext({ strict: "1" }, DEFAULT_DIMENSION_LIMIT);
    expect(ctx.strict).toBe(true);
  });

  test("creates context with strict=false for false", () => {
    const ctx = createParseContext({ strict: "false" }, DEFAULT_DIMENSION_LIMIT);
    expect(ctx.strict).toBe(false);
  });

  test("creates context with strict=false for 0", () => {
    const ctx = createParseContext({ strict: "0" }, DEFAULT_DIMENSION_LIMIT);
    expect(ctx.strict).toBe(false);
  });

  test("creates context with strict=true for unrecognized value like 'yes'", () => {
    const ctx = createParseContext({ strict: "yes" }, DEFAULT_DIMENSION_LIMIT);
    expect(ctx.strict).toBe(true);
    // No warning is added for the strict param itself
    expect(ctx.warnings).toEqual([]);
  });

  test("creates context with strict=true for empty string", () => {
    const ctx = createParseContext({ strict: "" }, DEFAULT_DIMENSION_LIMIT);
    expect(ctx.strict).toBe(true);
  });

  test("initializes new ParseContext fields", () => {
    const ctx = createParseContext({}, DEFAULT_DIMENSION_LIMIT);
    expect(ctx.failFast).toBe(false);
    expect(ctx.fromString).toBe(true);
    expect(ctx.prefix).toBe("");
  });
});

describe("parseImageOps", () => {
  describe("format parsing", () => {
    test("returns jpeg as default format", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.format).toBe(ImageType.Jpeg);
    });

    test("parses valid format", () => {
      const { options } = parseImageOps({ format: "png" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.format).toBe(ImageType.Png);
    });

    test("parses format case-insensitively", () => {
      const { options } = parseImageOps({ format: "PNG" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.format).toBe(ImageType.Png);
    });

    test("parses all valid formats", () => {
      const formats: [string, ImageType][] = [
        ["avif", ImageType.Avif],
        ["gif", ImageType.Gif],
        ["heic", ImageType.Heic],
        ["jpeg", ImageType.Jpeg],
        ["jpg", ImageType.Jpeg],
        ["jxl", ImageType.JpegXL],
        ["pdf", ImageType.Pdf],
        ["png", ImageType.Png],
        ["raw", ImageType.Raw],
        ["svg", ImageType.Svg],
        ["tiff", ImageType.Tiff],
        ["tif", ImageType.Tiff],
        ["webp", ImageType.Webp],
      ];

      for (const [input, expected] of formats) {
        const { options } = parseImageOps(
          { format: input },
          "",
          DEFAULT_DIMENSION_LIMIT,
        );
        expect(options.format).toBe(expected);
      }
    });

    test("warns on unknown format and falls back to jpeg", () => {
      const { options, ctx } = parseImageOps(
        { format: "bmp" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.format).toBe(ImageType.Jpeg);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("format");
      expect(ctx.warnings[0].value).toBe("bmp");
      expect(ctx.warnings[0].reason).toContain("unknown format");
    });

    test("throws in strict mode on unknown format", () => {
      expect(() => {
        parseImageOps({ format: "bmp", strict: "true" }, "", DEFAULT_DIMENSION_LIMIT);
      }).toThrow(HttpError);
    });

    test("parses comma-separated formats with Accept header negotiation", () => {
      const { options } = parseImageOps(
        { format: "avif,webp,jpeg" },
        "image/webp",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.format).toBe(ImageType.Webp);
    });

    test("falls back to last format when Accept header does not match", () => {
      const { options } = parseImageOps(
        { format: "avif,webp,jpeg" },
        "image/png",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.format).toBe(ImageType.Jpeg);
    });
  });

  describe("width parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.width).toBeUndefined();
    });

    test("parses valid width", () => {
      const { options } = parseImageOps({ width: "100" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.width).toBe(100);
    });

    test("warns and clamps width to 1 when less than 1", () => {
      const { options, ctx } = parseImageOps(
        { width: "0" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.width).toBe(1);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("width");
      expect(ctx.warnings[0].reason).toContain("at least 1");
    });

    test("warns and clamps width to dimension limit when exceeded", () => {
      const { options, ctx } = parseImageOps(
        { width: "99999" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.width).toBe(DEFAULT_DIMENSION_LIMIT);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("width");
      expect(ctx.warnings[0].reason).toContain(`at most ${DEFAULT_DIMENSION_LIMIT}`);
    });

    test("warns on non-integer width", () => {
      const { options, ctx } = parseImageOps(
        { width: "abc" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.width).toBeUndefined();
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("width");
      expect(ctx.warnings[0].reason).toContain("positive integer");
    });

    test("warns on float width", () => {
      const { options, ctx } = parseImageOps(
        { width: "100.5" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.width).toBeUndefined();
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("width");
    });

    test("throws in strict mode on invalid width", () => {
      expect(() => {
        parseImageOps({ width: "abc", strict: "true" }, "", DEFAULT_DIMENSION_LIMIT);
      }).toThrow(HttpError);
    });
  });

  describe("height parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.height).toBeUndefined();
    });

    test("parses valid height", () => {
      const { options } = parseImageOps({ height: "200" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.height).toBe(200);
    });

    test("warns and clamps height to dimension limit when exceeded", () => {
      const { options, ctx } = parseImageOps(
        { height: "99999" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.height).toBe(DEFAULT_DIMENSION_LIMIT);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("height");
    });
  });

  describe("quality parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.quality).toBeUndefined();
    });

    test("parses valid quality", () => {
      const { options } = parseImageOps({ quality: "80" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.quality).toBe(80);
    });

    test("warns and clamps quality to 1 when below", () => {
      const { options, ctx } = parseImageOps(
        { quality: "0" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.quality).toBe(1);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("quality");
      expect(ctx.warnings[0].reason).toContain("at least 1");
    });

    test("warns and clamps quality to 100 when above", () => {
      const { options, ctx } = parseImageOps(
        { quality: "150" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.quality).toBe(100);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("quality");
      expect(ctx.warnings[0].reason).toContain("at most 100");
    });

    test("warns on non-integer quality", () => {
      const { options, ctx } = parseImageOps(
        { quality: "abc" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.quality).toBeUndefined();
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("quality");
    });

    test("throws in strict mode on invalid quality", () => {
      expect(() => {
        parseImageOps({ quality: "abc", strict: "true" }, "", DEFAULT_DIMENSION_LIMIT);
      }).toThrow(HttpError);
    });
  });

  describe("blur parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.blur).toBeUndefined();
    });

    test("returns undefined for false", () => {
      const { options } = parseImageOps({ blur: "false" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.blur).toBeUndefined();
    });

    test("returns undefined for 0", () => {
      const { options } = parseImageOps({ blur: "0" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.blur).toBeUndefined();
    });

    test("returns true for empty string", () => {
      const { options } = parseImageOps({ blur: "" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.blur).toBe(true);
    });

    test("returns true for true", () => {
      const { options } = parseImageOps({ blur: "true" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.blur).toBe(true);
    });

    test("returns true for 1", () => {
      const { options } = parseImageOps({ blur: "1" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.blur).toBe(true);
    });

    test("parses numeric blur value", () => {
      const { options } = parseImageOps({ blur: "5.5" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.blur).toBe(5.5);
    });

    test("warns and clamps blur to 0.3 when below", () => {
      const { options, ctx } = parseImageOps(
        { blur: "0.1" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.blur).toBe(0.3);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("blur");
      expect(ctx.warnings[0].reason).toContain("at least 0.3");
    });

    test("warns and clamps blur to 1000 when above", () => {
      const { options, ctx } = parseImageOps(
        { blur: "2000" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.blur).toBe(1000);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("blur");
      expect(ctx.warnings[0].reason).toContain("at most 1000");
    });

    test("warns and returns undefined for invalid blur (bug fix)", () => {
      const { options, ctx } = parseImageOps(
        { blur: "abc" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.blur).toBeUndefined();
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("blur");
      expect(ctx.warnings[0].reason).toContain("boolean or number");
    });

    test("throws in strict mode on invalid blur", () => {
      expect(() => {
        parseImageOps({ blur: "abc", strict: "true" }, "", DEFAULT_DIMENSION_LIMIT);
      }).toThrow(HttpError);
    });
  });

  describe("boolean parameters (greyscale, lossless, progressive)", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.greyscale).toBeUndefined();
      expect(options.lossless).toBeUndefined();
      expect(options.progressive).toBeUndefined();
    });

    test("returns true for true", () => {
      const { options } = parseImageOps(
        { greyscale: "true" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.greyscale).toBe(true);
    });

    test("returns true for 1", () => {
      const { options } = parseImageOps(
        { greyscale: "1" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.greyscale).toBe(true);
    });

    test("returns true for empty string", () => {
      const { options } = parseImageOps({ greyscale: "" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.greyscale).toBe(true);
    });

    test("returns false for false", () => {
      const { options } = parseImageOps(
        { greyscale: "false" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.greyscale).toBe(false);
    });

    test("returns false for 0", () => {
      const { options } = parseImageOps(
        { greyscale: "0" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.greyscale).toBe(false);
    });

    test("warns on invalid boolean value and treats as true", () => {
      const { options, ctx } = parseImageOps(
        { greyscale: "yes" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.greyscale).toBe(true);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("greyscale");
      expect(ctx.warnings[0].reason).toContain("true, false, 1, or 0");
    });

    test("throws in strict mode on invalid boolean", () => {
      expect(() => {
        parseImageOps(
          { greyscale: "yes", strict: "true" },
          "",
          DEFAULT_DIMENSION_LIMIT,
        );
      }).toThrow(HttpError);
    });
  });

  describe("effort parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.effort).toBeUndefined();
    });

    test("returns undefined for unsupported format (jpeg)", () => {
      const { options } = parseImageOps(
        { format: "jpeg", effort: "5" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBeUndefined();
    });

    test("parses valid effort for avif (0-9)", () => {
      const { options } = parseImageOps(
        { format: "avif", effort: "5" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBe(5);
    });

    test("warns and clamps effort for avif when below range", () => {
      const { options, ctx } = parseImageOps(
        { format: "avif", effort: "-1" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBeUndefined(); // -1 is not a valid u32
      expect(ctx.warnings).toHaveLength(1);
    });

    test("warns and clamps effort for avif when above range", () => {
      const { options, ctx } = parseImageOps(
        { format: "avif", effort: "15" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBe(9);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("effort");
      expect(ctx.warnings[0].reason).toContain("at most 9");
    });

    test("parses valid effort for png (1-10)", () => {
      const { options } = parseImageOps(
        { format: "png", effort: "7" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBe(7);
    });

    test("warns and clamps effort for png when below range", () => {
      const { options, ctx } = parseImageOps(
        { format: "png", effort: "0" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBe(1);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].reason).toContain("at least 1");
    });

    test("parses valid effort for webp (0-6)", () => {
      const { options } = parseImageOps(
        { format: "webp", effort: "4" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBe(4);
    });

    test("warns and clamps effort for webp when above range", () => {
      const { options, ctx } = parseImageOps(
        { format: "webp", effort: "10" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBe(6);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].reason).toContain("at most 6");
    });

    test("parses valid effort for jxl (1-9)", () => {
      const { options } = parseImageOps(
        { format: "jxl", effort: "5" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.effort).toBe(5);
    });
  });

  describe("fit parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.fit).toBeUndefined();
    });

    test("parses all valid fit values", () => {
      const fits: [string, ImageFit][] = [
        ["cover", ImageFit.Cover],
        ["contain", ImageFit.Contain],
        ["fill", ImageFit.Fill],
        ["inside", ImageFit.Inside],
        ["outside", ImageFit.Outside],
      ];

      for (const [input, expected] of fits) {
        const { options } = parseImageOps({ fit: input }, "", DEFAULT_DIMENSION_LIMIT);
        expect(options.fit).toBe(expected);
      }
    });

    test("warns on unknown fit value", () => {
      const { options, ctx } = parseImageOps(
        { fit: "stretch" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.fit).toBeUndefined();
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("fit");
      expect(ctx.warnings[0].reason).toContain("unknown value");
    });

    test("throws in strict mode on unknown fit", () => {
      expect(() => {
        parseImageOps({ fit: "stretch", strict: "true" }, "", DEFAULT_DIMENSION_LIMIT);
      }).toThrow(HttpError);
    });
  });

  describe("kernel parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.kernel).toBeUndefined();
    });

    test("parses all valid kernel values", () => {
      const kernels: [string, ImageKernel][] = [
        ["nearest", ImageKernel.Nearest],
        ["linear", ImageKernel.Linear],
        ["cubic", ImageKernel.Cubic],
        ["mitchell", ImageKernel.Mitchell],
        ["lanczos2", ImageKernel.Lanczos2],
        ["lanczos3", ImageKernel.Lanczos3],
        ["mks2013", ImageKernel.MKS2013],
        ["mks2021", ImageKernel.MKS2021],
      ];

      for (const [input, expected] of kernels) {
        const { options } = parseImageOps(
          { kernel: input },
          "",
          DEFAULT_DIMENSION_LIMIT,
        );
        expect(options.kernel).toBe(expected);
      }
    });

    test("warns on unknown kernel value", () => {
      const { options, ctx } = parseImageOps(
        { kernel: "bilinear" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.kernel).toBeUndefined();
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("kernel");
    });

    test("throws in strict mode on unknown kernel", () => {
      expect(() => {
        parseImageOps(
          { kernel: "bilinear", strict: "true" },
          "",
          DEFAULT_DIMENSION_LIMIT,
        );
      }).toThrow(HttpError);
    });
  });

  describe("position parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.position).toBeUndefined();
    });

    test("parses valid position values", () => {
      const positions: [string, ImagePosition][] = [
        ["top", ImagePosition.Top],
        ["right", ImagePosition.Right],
        ["bottom", ImagePosition.Bottom],
        ["left", ImagePosition.Left],
        ["center", ImagePosition.Center],
        ["entropy", ImagePosition.Entropy],
        ["attention", ImagePosition.Attention],
      ];

      for (const [input, expected] of positions) {
        const { options } = parseImageOps(
          { position: input },
          "",
          DEFAULT_DIMENSION_LIMIT,
        );
        expect(options.position).toBe(expected);
      }
    });

    test("warns on unknown position value", () => {
      const { options, ctx } = parseImageOps(
        { position: "middle" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.position).toBeUndefined();
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("position");
    });
  });

  describe("preset parsing", () => {
    test("returns undefined when not provided", () => {
      const { options } = parseImageOps({}, "", DEFAULT_DIMENSION_LIMIT);
      expect(options.preset).toBeUndefined();
    });

    test("parses valid preset values", () => {
      const presets = ["default", "quality", "size"];

      for (const preset of presets) {
        const { options } = parseImageOps({ preset }, "", DEFAULT_DIMENSION_LIMIT);
        expect(options.preset).toBe(preset);
      }
    });

    test("warns on unknown preset value", () => {
      const { options, ctx } = parseImageOps(
        { preset: "fast" },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(options.preset).toBeUndefined();
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("preset");
    });

    test("throws in strict mode on unknown preset", () => {
      expect(() => {
        parseImageOps({ preset: "fast", strict: "true" }, "", DEFAULT_DIMENSION_LIMIT);
      }).toThrow(HttpError);
    });
  });

  describe("unknown parameters", () => {
    test("warns on unknown parameters", () => {
      const { ctx } = parseImageOps({ unknown: "value" }, "", DEFAULT_DIMENSION_LIMIT);
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0].param).toBe("unknown");
      expect(ctx.warnings[0].reason).toBe("unknown parameter");
    });

    test("throws in strict mode on unknown parameters", () => {
      expect(() => {
        parseImageOps(
          { unknown: "value", strict: "true" },
          "",
          DEFAULT_DIMENSION_LIMIT,
        );
      }).toThrow(HttpError);
    });

    test("does not warn on known parameters", () => {
      const { ctx } = parseImageOps(
        {
          url: "http://example.com/image.png",
          format: "png",
          width: "100",
          height: "100",
          quality: "80",
          effort: "5",
          blur: "true",
          greyscale: "true",
          lossless: "false",
          progressive: "true",
          fit: "cover",
          kernel: "lanczos3",
          position: "center",
          preset: "default",
          strict: "false",
        },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(ctx.warnings).toHaveLength(0);
    });
  });

  describe("multiple warnings", () => {
    test("collects multiple warnings in lenient mode", () => {
      const { options, ctx } = parseImageOps(
        {
          width: "abc",
          height: "-1",
          quality: "abc",
          blur: "abc",
        },
        "",
        DEFAULT_DIMENSION_LIMIT,
      );
      expect(ctx.warnings.length).toBeGreaterThan(1);
      expect(options.width).toBeUndefined();
      expect(options.blur).toBeUndefined();
    });

    test("throws with all errors in strict mode", () => {
      try {
        parseImageOps(
          {
            width: "abc",
            quality: "abc",
            strict: "true",
          },
          "",
          DEFAULT_DIMENSION_LIMIT,
        );
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.code).toBe(400);
        expect(err.body).toContain("width");
        expect(err.body).toContain("quality");
      }
    });
  });

  describe("error format for transform endpoint", () => {
    test("returns plain text error in strict mode", () => {
      try {
        parseImageOps({ format: "bmp", strict: "true" }, "", DEFAULT_DIMENSION_LIMIT);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.code).toBe(400);
        expect(err.body).toContain("Invalid parameters:");
        expect(err.body).toContain("format:");
        expect(err.body).toContain('(got "bmp")');
      }
    });
  });
});

describe("parseMetadataOps", () => {
  describe("boolean parameters", () => {
    test("returns false by default for all options", () => {
      const result = parseMetadataOps({});
      expect(result.exif).toBe(false);
      expect(result.stats).toBe(false);
      expect(result.thumbhash).toBe(false);
    });

    test("parses exif=true", () => {
      const result = parseMetadataOps({ exif: "true" });
      expect(result.exif).toBe(true);
      expect(result.stats).toBe(false);
      expect(result.thumbhash).toBe(false);
    });

    test("parses stats=1", () => {
      const result = parseMetadataOps({ stats: "1" });
      expect(result.stats).toBe(true);
    });

    test("parses thumbhash=true", () => {
      const result = parseMetadataOps({ thumbhash: "true" });
      expect(result.thumbhash).toBe(true);
    });

    test("parses multiple options", () => {
      const result = parseMetadataOps({
        exif: "true",
        stats: "true",
        thumbhash: "true",
      });
      expect(result.exif).toBe(true);
      expect(result.stats).toBe(true);
      expect(result.thumbhash).toBe(true);
    });

    test("warns on invalid boolean value", () => {
      const result = parseMetadataOps({ exif: "yes" });
      expect(result.exif).toBe(true); // Treated as true in lenient mode
      expect(result.ctx.warnings).toHaveLength(1);
      expect(result.ctx.warnings[0].param).toBe("exif");
    });
  });

  describe("unknown parameters", () => {
    test("warns on unknown parameters", () => {
      const result = parseMetadataOps({ unknown: "value" });
      expect(result.ctx.warnings).toHaveLength(1);
      expect(result.ctx.warnings[0].param).toBe("unknown");
      expect(result.ctx.warnings[0].reason).toBe("unknown parameter");
    });

    test("does not warn on known parameters", () => {
      const result = parseMetadataOps({
        url: "http://example.com/image.png",
        exif: "true",
        stats: "false",
        thumbhash: "1",
        strict: "false",
      });
      expect(result.ctx.warnings).toHaveLength(0);
    });
  });

  describe("strict mode", () => {
    test("throws on invalid parameter in strict mode", () => {
      expect(() => {
        parseMetadataOps({ exif: "maybe", strict: "true" });
      }).toThrow(HttpError);
    });

    test("throws on unknown parameter in strict mode", () => {
      expect(() => {
        parseMetadataOps({ unknown: "value", strict: "true" });
      }).toThrow(HttpError);
    });

    test("returns JSON error format in strict mode", () => {
      try {
        parseMetadataOps({ exif: "maybe", strict: "true" });
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.code).toBe(400);
        const body = JSON.parse(err.body);
        expect(body.error).toBe("Invalid parameters");
        expect(body.details).toBeInstanceOf(Array);
        expect(body.details[0].param).toBe("exif");
        expect(body.details[0].value).toBe("maybe");
      }
    });
  });
});

describe("warnings header behavior", () => {
  test("warnings are collected in lenient mode", () => {
    const { ctx } = parseImageOps({ width: "99999" }, "", DEFAULT_DIMENSION_LIMIT);
    expect(ctx.strict).toBe(false);
    expect(ctx.warnings.length).toBeGreaterThan(0);
  });

  test("warnings can be converted to header format", () => {
    const { ctx } = parseImageOps(
      { width: "99999", quality: "200" },
      "",
      DEFAULT_DIMENSION_LIMIT,
    );
    const header = ctx.warnings.map((w) => `${w.param}: ${w.reason}`).join("; ");
    expect(header).toContain("width:");
    expect(header).toContain("quality:");
  });
});
