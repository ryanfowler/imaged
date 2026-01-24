import { describe, test, expect } from "bun:test";
import { getPreset } from "./presets.ts";
import { ImageType } from "./types.ts";

describe("getPreset", () => {
  describe("AVIF presets", () => {
    test("returns default preset", () => {
      const preset = getPreset(ImageType.Avif);
      expect(preset.quality).toBe(45);
      expect(preset.effort).toBe(2);
      expect(preset.chromaSubsampling).toBe("4:2:0");
    });

    test("returns quality preset", () => {
      const preset = getPreset(ImageType.Avif, "quality");
      expect(preset.quality).toBe(60);
      expect(preset.effort).toBe(6);
      expect(preset.chromaSubsampling).toBe("4:4:4");
    });

    test("returns size preset", () => {
      const preset = getPreset(ImageType.Avif, "size");
      expect(preset.quality).toBe(40);
      expect(preset.effort).toBe(6);
      expect(preset.chromaSubsampling).toBe("4:2:0");
    });
  });

  describe("HEIC presets", () => {
    test("returns default preset", () => {
      const preset = getPreset(ImageType.Heic);
      expect(preset.quality).toBe(45);
      expect(preset.effort).toBe(2);
      expect(preset.chromaSubsampling).toBe("4:2:0");
    });

    test("returns quality preset", () => {
      const preset = getPreset(ImageType.Heic, "quality");
      expect(preset.quality).toBe(60);
      expect(preset.effort).toBe(6);
      expect(preset.chromaSubsampling).toBe("4:4:4");
    });

    test("returns size preset", () => {
      const preset = getPreset(ImageType.Heic, "size");
      expect(preset.quality).toBe(40);
      expect(preset.effort).toBe(6);
      expect(preset.chromaSubsampling).toBe("4:2:0");
    });
  });

  describe("JPEG presets", () => {
    test("returns default preset", () => {
      const preset = getPreset(ImageType.Jpeg);
      expect(preset.quality).toBe(75);
      expect(preset.progressive).toBe(true);
      expect(preset.chromaSubsampling).toBe("4:2:0");
      expect(preset.mozjpeg).toBe(false);
    });

    test("returns quality preset", () => {
      const preset = getPreset(ImageType.Jpeg, "quality");
      expect(preset.quality).toBe(90);
      expect(preset.progressive).toBe(false);
      expect(preset.chromaSubsampling).toBe("4:4:4");
      expect(preset.mozjpeg).toBe(false);
      expect(preset.optimiseCoding).toBe(false);
    });

    test("returns size preset", () => {
      const preset = getPreset(ImageType.Jpeg, "size");
      expect(preset.quality).toBe(70);
      expect(preset.progressive).toBe(true);
      expect(preset.chromaSubsampling).toBe("4:2:0");
      expect(preset.mozjpeg).toBe(true);
    });
  });

  describe("JXL presets", () => {
    test("returns default preset", () => {
      const preset = getPreset(ImageType.JpegXL);
      expect(preset.quality).toBe(75);
      expect(preset.effort).toBe(3);
      expect(preset.decodingTier).toBe(2);
    });

    test("returns quality preset", () => {
      const preset = getPreset(ImageType.JpegXL, "quality");
      expect(preset.quality).toBe(90);
      expect(preset.effort).toBe(7);
      expect(preset.decodingTier).toBe(0);
    });

    test("returns size preset", () => {
      const preset = getPreset(ImageType.JpegXL, "size");
      expect(preset.quality).toBe(70);
      expect(preset.effort).toBe(7);
      expect(preset.decodingTier).toBe(0);
    });
  });

  describe("PNG presets", () => {
    test("returns default preset", () => {
      const preset = getPreset(ImageType.Png);
      expect(preset.compressionLevel).toBe(4);
      expect(preset.adaptiveFiltering).toBe(true);
      expect(preset.palette).toBe(false);
    });

    test("returns quality preset", () => {
      const preset = getPreset(ImageType.Png, "quality");
      expect(preset.compressionLevel).toBe(7);
      expect(preset.adaptiveFiltering).toBe(true);
      expect(preset.palette).toBe(false);
    });

    test("returns size preset", () => {
      const preset = getPreset(ImageType.Png, "size");
      expect(preset.compressionLevel).toBe(9);
      expect(preset.adaptiveFiltering).toBe(true);
      expect(preset.palette).toBe(true);
      expect(preset.effort).toBe(7);
      expect(preset.colours).toBe(256);
    });
  });

  describe("TIFF presets", () => {
    test("returns default preset", () => {
      const preset = getPreset(ImageType.Tiff);
      expect(preset.compression).toBe("lzw");
      expect(preset.predictor).toBe("horizontal");
    });

    test("returns quality preset", () => {
      const preset = getPreset(ImageType.Tiff, "quality");
      expect(preset.compression).toBe("lzw");
      expect(preset.predictor).toBe("horizontal");
    });

    test("returns size preset", () => {
      const preset = getPreset(ImageType.Tiff, "size");
      expect(preset.compression).toBe("jpeg");
      expect(preset.quality).toBe(80);
    });
  });

  describe("WebP presets", () => {
    test("returns default preset", () => {
      const preset = getPreset(ImageType.Webp);
      expect(preset.quality).toBe(75);
      expect(preset.effort).toBe(2);
      expect(preset.smartSubsample).toBe(true);
    });

    test("returns quality preset", () => {
      const preset = getPreset(ImageType.Webp, "quality");
      expect(preset.quality).toBe(88);
      expect(preset.effort).toBe(5);
      expect(preset.smartSubsample).toBe(true);
      expect(preset.smartDeblock).toBe(true);
    });

    test("returns size preset", () => {
      const preset = getPreset(ImageType.Webp, "size");
      expect(preset.quality).toBe(70);
      expect(preset.effort).toBe(5);
      expect(preset.smartSubsample).toBe(true);
      expect(preset.alphaQuality).toBe(80);
    });
  });

  describe("unsupported types", () => {
    test("returns empty object for GIF", () => {
      const preset = getPreset(ImageType.Gif);
      expect(preset).toEqual({});
    });

    test("returns empty object for PDF", () => {
      const preset = getPreset(ImageType.Pdf);
      expect(preset).toEqual({});
    });

    test("returns empty object for SVG", () => {
      const preset = getPreset(ImageType.Svg);
      expect(preset).toEqual({});
    });

    test("returns empty object for Raw", () => {
      const preset = getPreset(ImageType.Raw);
      expect(preset).toEqual({});
    });
  });
});
