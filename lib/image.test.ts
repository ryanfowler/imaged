import { describe, test, expect, beforeAll } from "bun:test";
import { ImageEngine, detectImageFormat } from "./image.ts";
import { HttpError, ImageType, ImageFit, ImageKernel } from "./types.ts";
import sharp from "sharp";

// Test image buffers created before tests run
let jpegBuffer: Buffer;
let pngBuffer: Buffer;
let webpBuffer: Buffer;
let gifBuffer: Buffer;
let tiffBuffer: Buffer;
let pngWithAlpha: Buffer;

// Create test images before all tests
beforeAll(async () => {
  // Create a 100x100 red JPEG
  jpegBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();

  // Create a 100x100 green PNG
  pngBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 0, g: 255, b: 0 },
    },
  })
    .png()
    .toBuffer();

  // Create a 100x100 blue WebP
  webpBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 0, g: 0, b: 255 },
    },
  })
    .webp()
    .toBuffer();

  // Create a 100x100 yellow GIF
  gifBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 255, b: 0 },
    },
  })
    .gif()
    .toBuffer();

  // Create a 100x100 cyan TIFF
  tiffBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 0, g: 255, b: 255 },
    },
  })
    .tiff()
    .toBuffer();

  // Create a PNG with alpha channel (transparent)
  pngWithAlpha = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
});

describe("detectImageFormat", () => {
  test("detects JPEG format", () => {
    expect(detectImageFormat(jpegBuffer)).toBe(ImageType.Jpeg);
  });

  test("detects PNG format", () => {
    expect(detectImageFormat(pngBuffer)).toBe(ImageType.Png);
  });

  test("detects WebP format", () => {
    expect(detectImageFormat(webpBuffer)).toBe(ImageType.Webp);
  });

  test("detects GIF format", () => {
    expect(detectImageFormat(gifBuffer)).toBe(ImageType.Gif);
  });

  test("detects TIFF format (little endian)", () => {
    expect(detectImageFormat(tiffBuffer)).toBe(ImageType.Tiff);
  });

  test("throws for buffer too small", () => {
    const small = Buffer.from([0x00, 0x01, 0x02]);
    expect(() => detectImageFormat(small)).toThrow(HttpError);
    expect(() => detectImageFormat(small)).toThrow(/unknown image type/);
  });

  test("throws for unknown format", () => {
    const unknown = Buffer.alloc(100, 0x00);
    expect(() => detectImageFormat(unknown)).toThrow(/unknown image type/);
  });

  test("detects SVG format", () => {
    const svg = Buffer.from(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`,
    );
    expect(detectImageFormat(svg)).toBe(ImageType.Svg);
  });

  test("detects SVG with BOM", () => {
    const svgWithBom = Buffer.from(
      `\ufeff<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
    );
    expect(detectImageFormat(svgWithBom)).toBe(ImageType.Svg);
  });

  test("rejects HTML with embedded SVG", () => {
    const html = Buffer.from(`<!DOCTYPE html><html><body><svg></svg></body></html>`);
    expect(() => detectImageFormat(html)).toThrow(/unknown image type/);
  });

  test("detects PDF format", () => {
    const pdf = Buffer.from("%PDF-1.4 fake pdf content that is long enough");
    expect(detectImageFormat(pdf)).toBe(ImageType.Pdf);
  });

  test("detects JPEG XL codestream", () => {
    // JPEG XL codestream starts with 0xff 0x0a
    const jxl = Buffer.alloc(20);
    jxl[0] = 0xff;
    jxl[1] = 0x0a;
    expect(detectImageFormat(jxl)).toBe(ImageType.JpegXL);
  });

  test("detects JPEG XL container", () => {
    // JPEG XL container starts with specific bytes
    const jxl = Buffer.from([
      0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(detectImageFormat(jxl)).toBe(ImageType.JpegXL);
  });
});

describe("ImageEngine", () => {
  let engine: ImageEngine;

  beforeAll(() => {
    engine = new ImageEngine({ concurrency: 2, pixelLimit: 100000000 });
  });

  describe("constructor", () => {
    test("initializes with decoders and encoders", () => {
      expect(engine.decoders.length).toBeGreaterThan(0);
      expect(engine.encoders.length).toBeGreaterThan(0);
    });

    test("has access to Sharp versions", () => {
      expect(ImageEngine.VERSIONS).toBeDefined();
      expect(ImageEngine.VERSIONS.sharp).toBeDefined();
    });
  });

  describe("perform", () => {
    test("converts JPEG to PNG", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Png,
      });

      expect(result.format).toBe(ImageType.Png);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
      expect(detectImageFormat(result.data)).toBe(ImageType.Png);
    });

    test("converts PNG to JPEG", async () => {
      const result = await engine.perform({
        data: pngBuffer,
        format: ImageType.Jpeg,
      });

      expect(result.format).toBe(ImageType.Jpeg);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
      expect(detectImageFormat(result.data)).toBe(ImageType.Jpeg);
    });

    test("converts to WebP", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Webp,
      });

      expect(result.format).toBe(ImageType.Webp);
      expect(detectImageFormat(result.data)).toBe(ImageType.Webp);
    });

    test("resizes image with width", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        width: 50,
      });

      expect(result.width).toBe(50);
      expect(result.height).toBe(50); // Square image stays square
    });

    test("resizes image with height", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        height: 25,
      });

      expect(result.height).toBe(25);
      expect(result.width).toBe(25);
    });

    test("resizes with both width and height", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        width: 50,
        height: 30,
      });

      // With default fit (cover), it should fit within bounds
      expect(result.width).toBeLessThanOrEqual(50);
      expect(result.height).toBeLessThanOrEqual(30);
    });

    test("respects fit option", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        width: 50,
        height: 30,
        fit: ImageFit.Fill,
      });

      expect(result.width).toBe(50);
      expect(result.height).toBe(30);
    });

    test("applies blur with boolean", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        blur: true,
      });

      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
      // Blurred image should still be valid JPEG
      expect(detectImageFormat(result.data)).toBe(ImageType.Jpeg);
    });

    test("applies blur with sigma value", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        blur: 5.5,
      });

      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
      expect(detectImageFormat(result.data)).toBe(ImageType.Jpeg);
    });

    test("applies different blur intensities", async () => {
      const lightBlur = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        blur: 0.3,
      });

      const heavyBlur = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        blur: 50,
      });

      // Both should be valid images
      expect(detectImageFormat(lightBlur.data)).toBe(ImageType.Jpeg);
      expect(detectImageFormat(heavyBlur.data)).toBe(ImageType.Jpeg);
    });

    test("applies greyscale", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        greyscale: true,
      });

      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
      expect(detectImageFormat(result.data)).toBe(ImageType.Jpeg);
    });

    test("applies custom quality", async () => {
      const lowQuality = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        quality: 10,
      });

      const highQuality = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        quality: 100,
      });

      // Low quality should produce smaller file
      expect(lowQuality.data.length).toBeLessThan(highQuality.data.length);
    });

    test("respects kernel option", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        width: 50,
        kernel: ImageKernel.Lanczos3,
      });

      expect(result.width).toBe(50);
    });

    test("does not enlarge with withoutEnlargement", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        width: 200, // Larger than original 100
      });

      // Should not enlarge
      expect(result.width).toBe(100);
    });

    test("applies preset", async () => {
      const defaultResult = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        preset: "default",
      });

      const qualityResult = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        preset: "quality",
      });

      // Quality preset should produce larger file
      expect(qualityResult.data.length).toBeGreaterThan(defaultResult.data.length);
    });

    test("throws for unsupported input format", async () => {
      const fake = Buffer.alloc(100, 0x42);
      await expect(
        engine.perform({
          data: fake,
          format: ImageType.Jpeg,
        }),
      ).rejects.toThrow(HttpError);
    });

    test("throws for PDF encoding", async () => {
      await expect(
        engine.perform({
          data: jpegBuffer,
          format: ImageType.Pdf,
        }),
      ).rejects.toThrow(/encoding type pdf is not supported/);
    });

    test("throws for SVG encoding", async () => {
      await expect(
        engine.perform({
          data: jpegBuffer,
          format: ImageType.Svg,
        }),
      ).rejects.toThrow(/encoding type svg is not supported/);
    });

    test("handles lossless WebP", async () => {
      const result = await engine.perform({
        data: pngBuffer,
        format: ImageType.Webp,
        lossless: true,
      });

      expect(result.format).toBe(ImageType.Webp);
      expect(detectImageFormat(result.data)).toBe(ImageType.Webp);
    });

    test("handles progressive JPEG", async () => {
      const result = await engine.perform({
        data: jpegBuffer,
        format: ImageType.Jpeg,
        progressive: true,
      });

      expect(result.format).toBe(ImageType.Jpeg);
    });
  });

  describe("metadata", () => {
    test("returns basic metadata for JPEG", async () => {
      const result = await engine.metadata({
        data: jpegBuffer,
        exif: false,
        stats: false,
        thumbhash: false,
      });

      expect(result.format).toBe(ImageType.Jpeg);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
      expect(result.size).toBe(jpegBuffer.length);
      expect(result.channels).toBe(3);
    });

    test("returns basic metadata for PNG", async () => {
      const result = await engine.metadata({
        data: pngBuffer,
        exif: false,
        stats: false,
        thumbhash: false,
      });

      expect(result.format).toBe(ImageType.Png);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    test("detects alpha channel", async () => {
      const result = await engine.metadata({
        data: pngWithAlpha,
        exif: false,
        stats: false,
        thumbhash: false,
      });

      expect(result.hasAlpha).toBe(true);
      expect(result.channels).toBe(4);
    });

    test("includes stats when requested", async () => {
      const result = await engine.metadata({
        data: jpegBuffer,
        exif: false,
        stats: true,
        thumbhash: false,
      });

      expect(result.stats).toBeDefined();
      expect(result.stats!.isOpaque).toBe(true);
      expect(typeof result.stats!.entropy).toBe("number");
      expect(typeof result.stats!.sharpness).toBe("number");
      expect(result.stats!.dominant).toBeDefined();
      expect(result.stats!.dominant.r).toBeDefined();
      expect(result.stats!.dominant.g).toBeDefined();
      expect(result.stats!.dominant.b).toBeDefined();
    });

    test("includes thumbhash when requested", async () => {
      const result = await engine.metadata({
        data: jpegBuffer,
        exif: false,
        stats: false,
        thumbhash: true,
      });

      expect(result.thumbhash).toBeDefined();
      expect(typeof result.thumbhash).toBe("string");
      // Thumbhash is base64 encoded
      expect(() => Buffer.from(result.thumbhash!, "base64")).not.toThrow();
    });

    test("returns stats rounded to 3 decimal places", async () => {
      const result = await engine.metadata({
        data: jpegBuffer,
        exif: false,
        stats: true,
        thumbhash: false,
      });

      // Check that entropy and sharpness have at most 3 decimal places
      const entropyStr = result.stats!.entropy.toString();
      const sharpnessStr = result.stats!.sharpness.toString();

      const decimals = (s: string) => {
        const parts = s.split(".");
        return parts.length > 1 ? parts[1].length : 0;
      };

      expect(decimals(entropyStr)).toBeLessThanOrEqual(3);
      expect(decimals(sharpnessStr)).toBeLessThanOrEqual(3);
    });

    test("includes color space", async () => {
      const result = await engine.metadata({
        data: jpegBuffer,
        exif: false,
        stats: false,
        thumbhash: false,
      });

      expect(result.space).toBeDefined();
      expect(typeof result.space).toBe("string");
    });

    test("throws for unsupported input format", async () => {
      const fake = Buffer.alloc(100, 0x42);
      await expect(
        engine.metadata({
          data: fake,
          exif: false,
          stats: false,
          thumbhash: false,
        }),
      ).rejects.toThrow(HttpError);
    });
  });

  describe("concurrency", () => {
    test("limits concurrent operations", async () => {
      // Create engine with concurrency of 1
      const singleEngine = new ImageEngine({
        concurrency: 1,
        pixelLimit: 100000000,
      });

      const operation = async () => {
        const result = await singleEngine.perform({
          data: jpegBuffer,
          format: ImageType.Jpeg,
          width: 50,
        });
        return result;
      };

      // Run multiple operations - all should complete successfully
      const operations = Array.from({ length: 5 }, () => operation());
      const results = await Promise.all(operations);

      expect(results.length).toBe(5);
      results.forEach((result) => {
        expect(result.width).toBe(50);
      });
    });
  });
});

describe("format-specific encoding", () => {
  let engine: ImageEngine;

  beforeAll(() => {
    engine = new ImageEngine({ concurrency: 2, pixelLimit: 100000000 });
  });

  test("encodes GIF", async () => {
    const result = await engine.perform({
      data: pngBuffer,
      format: ImageType.Gif,
    });

    expect(result.format).toBe(ImageType.Gif);
    expect(detectImageFormat(result.data)).toBe(ImageType.Gif);
  });

  test("encodes TIFF", async () => {
    const result = await engine.perform({
      data: jpegBuffer,
      format: ImageType.Tiff,
    });

    expect(result.format).toBe(ImageType.Tiff);
    expect(detectImageFormat(result.data)).toBe(ImageType.Tiff);
  });

  test("encodes raw format", async () => {
    const result = await engine.perform({
      data: jpegBuffer,
      format: ImageType.Raw,
    });

    expect(result.format).toBe(ImageType.Raw);
    // Raw is uncompressed RGBA/RGB data
    expect(result.data.length).toBeGreaterThan(jpegBuffer.length);
  });
});
