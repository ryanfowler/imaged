import { describe, test, expect, mock } from "bun:test";
import { PipelineExecutor } from "./pipeline.ts";
import { HttpError, type PipelineConfig, type S3Config, ImageType } from "./types.ts";
import { getMimetype, validateContentType } from "./validation.ts";

// Mock S3 config for testing
const mockS3Config: S3Config = {
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
  region: "us-east-1",
};

const DEFAULT_DIMENSION_LIMIT = 16384;

// Helper to create a minimal valid config
function createValidConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    tasks: [
      {
        id: "task1",
        transform: { format: ImageType.Jpeg },
        output: { bucket: "test-bucket", key: "test.jpg" },
      },
    ],
    ...overrides,
  };
}

describe("getMimetype", () => {
  test("returns correct mimetype for avif", () => {
    expect(getMimetype("avif")).toBe("image/avif");
  });

  test("returns correct mimetype for gif", () => {
    expect(getMimetype("gif")).toBe("image/gif");
  });

  test("returns correct mimetype for heic", () => {
    expect(getMimetype("heic")).toBe("image/heic");
  });

  test("returns correct mimetype for jpeg", () => {
    expect(getMimetype("jpeg")).toBe("image/jpeg");
  });

  test("returns correct mimetype for jxl", () => {
    expect(getMimetype("jxl")).toBe("image/jxl");
  });

  test("returns correct mimetype for png", () => {
    expect(getMimetype("png")).toBe("image/png");
  });

  test("returns correct mimetype for pdf", () => {
    expect(getMimetype("pdf")).toBe("application/pdf");
  });

  test("returns correct mimetype for raw", () => {
    expect(getMimetype("raw")).toBe("application/octet-stream");
  });

  test("returns correct mimetype for svg", () => {
    expect(getMimetype("svg")).toBe("image/svg+xml");
  });

  test("returns correct mimetype for tiff", () => {
    expect(getMimetype("tiff")).toBe("image/tiff");
  });

  test("returns correct mimetype for webp", () => {
    expect(getMimetype("webp")).toBe("image/webp");
  });
});

describe("validateContentType", () => {
  test("accepts image/jpeg", () => {
    expect(validateContentType("image/jpeg", "test")).toBe("image/jpeg");
  });

  test("accepts image/png", () => {
    expect(validateContentType("image/png", "test")).toBe("image/png");
  });

  test("accepts image/webp", () => {
    expect(validateContentType("image/webp", "test")).toBe("image/webp");
  });

  test("accepts application/pdf", () => {
    expect(validateContentType("application/pdf", "test")).toBe("application/pdf");
  });

  test("accepts application/octet-stream", () => {
    expect(validateContentType("application/octet-stream", "test")).toBe(
      "application/octet-stream",
    );
  });

  test("rejects text/html", () => {
    expect(() => validateContentType("text/html", "test")).toThrow(
      "content type 'text/html' is not allowed",
    );
  });

  test("rejects text/javascript", () => {
    expect(() => validateContentType("text/javascript", "test")).toThrow(
      "content type 'text/javascript' is not allowed",
    );
  });

  test("rejects arbitrary content type", () => {
    expect(() => validateContentType("application/json", "test")).toThrow(
      "content type 'application/json' is not allowed",
    );
  });
});

describe("PipelineExecutor", () => {
  // Create mock dependencies
  const createMockEngine = () => ({
    perform: mock(() =>
      Promise.resolve({
        data: Buffer.from("test"),
        format: ImageType.Jpeg,
        width: 100,
        height: 100,
      }),
    ),
    metadata: mock(() =>
      Promise.resolve({
        format: "jpeg",
        width: 1000,
        height: 800,
        size: 12345,
        space: "srgb",
        channels: 3,
        depth: "uchar",
        hasProfile: false,
        hasAlpha: false,
      }),
    ),
    decoders: [ImageType.Jpeg, ImageType.Png],
    encoders: [ImageType.Jpeg, ImageType.Png],
  });

  const createMockClient = () => ({
    fetch: mock(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
  });

  describe("validation - structure", () => {
    test("throws error when tasks is not an array", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = { tasks: "not-an-array" } as unknown as PipelineConfig;

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        HttpError,
      );
      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "tasks must be an array",
      );
    });

    test("throws error when tasks array is empty", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = { tasks: [] };

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "at least one task is required",
      );
    });

    test("throws error when too many tasks", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 2,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k1" },
          },
          {
            id: "t2",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k2" },
          },
          {
            id: "t3",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k3" },
          },
        ],
      });

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "too many tasks: 3 (max: 2)",
      );
    });

    test("throws error when task id is missing", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k" },
          },
        ],
      } as unknown as PipelineConfig;

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "task[0]: id is required",
      );
    });

    test("throws error when task id is duplicate", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "same-id",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k1" },
          },
          {
            id: "same-id",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k2" },
          },
        ],
      });

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "task[1]: duplicate id 'same-id'",
      );
    });

    test("throws error when transform is missing", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            output: { bucket: "b", key: "k" },
          },
        ],
      } as unknown as PipelineConfig;

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "task[0]: transform is required",
      );
    });

    test("throws error when transform.format is missing", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: {},
            output: { bucket: "b", key: "k" },
          },
        ],
      } as unknown as PipelineConfig;

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "task[0]: transform.format is required",
      );
    });

    test("throws error when output is missing", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
          },
        ],
      } as unknown as PipelineConfig;

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "task[0]: output is required",
      );
    });

    test("throws error when output.bucket is missing", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
            output: { key: "k" },
          },
        ],
      } as unknown as PipelineConfig;

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "task[0]: output.bucket is required",
      );
    });

    test("throws error when output.key is missing", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b" },
          },
        ],
      } as unknown as PipelineConfig;

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "task[0]: output.key is required",
      );
    });
  });

  describe("validation - transform options", () => {
    test("throws error for invalid format", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: { format: "invalid" },
            output: { bucket: "b", key: "k" },
          },
        ],
      } as unknown as PipelineConfig;

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "unknown format 'invalid'",
      );
    });

    test("throws error for invalid width", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg, width: -10 },
            output: { bucket: "b", key: "k" },
          },
        ],
      });

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "must be at least 1",
      );
    });

    test("throws error for width exceeding dimension limit", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: 1000,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg, width: 2000 },
            output: { bucket: "b", key: "k" },
          },
        ],
      });

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "must be at most 1000",
      );
    });

    test("throws error for invalid quality", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg, quality: 200 },
            output: { bucket: "b", key: "k" },
          },
        ],
      });

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "must be at most 100",
      );
    });

    test("throws error for invalid blur", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg, blur: 0.1 },
            output: { bucket: "b", key: "k" },
          },
        ],
      });

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "must be at least 0.3",
      );
    });

    test("throws error for invalid fit", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg, fit: "invalid" as never },
            output: { bucket: "b", key: "k" },
          },
        ],
      });

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "unknown value 'invalid'",
      );
    });

    test("throws error for invalid effort for format", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Webp, effort: 10 },
            output: { bucket: "b", key: "k" },
          },
        ],
      });

      await expect(executor.execute(config, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "must be at most 6 for webp",
      );
    });
  });

  describe("validation - error message prefixes", () => {
    test("error for invalid width includes full task prefix", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg, width: -10 },
            output: { bucket: "b", key: "k" },
          },
        ],
      });

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.body).toBe("task[0].transform.width: must be at least 1");
      }
    });

    test("error for invalid format includes full task prefix", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: { format: "bmp" },
            output: { bucket: "b", key: "k" },
          },
        ],
      } as unknown as PipelineConfig;

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(String(err.body)).toContain("task[0].transform.format:");
        expect(String(err.body)).toContain("unknown format 'bmp'");
      }
    });

    test("error for second task uses correct index", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k1" },
          },
          {
            id: "t2",
            transform: { format: ImageType.Jpeg, quality: 200 },
            output: { bucket: "b", key: "k2" },
          },
        ],
      });

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.body).toBe("task[1].transform.quality: must be at most 100");
      }
    });

    test("error for invalid effort includes format in message", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Webp, effort: 10 },
            output: { bucket: "b", key: "k" },
          },
        ],
      });

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.body).toBe("task[0].transform.effort: must be at most 6 for webp");
      }
    });
  });

  describe("validation - metadata options", () => {
    test("throws error for invalid metadata exif value", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k" },
            metadata: { exif: "invalid" },
          },
        ],
      } as unknown as PipelineConfig;

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.body).toBe("task[0].metadata.exif: must be a boolean");
      }
    });

    test("throws error for invalid metadata stats value", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k" },
            metadata: { stats: 42 },
          },
        ],
      } as unknown as PipelineConfig;

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.body).toBe("task[0].metadata.stats: must be a boolean");
      }
    });

    test("metadata error for second task uses correct index", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = {
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k1" },
          },
          {
            id: "t2",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k2" },
            metadata: { thumbhash: "yes" },
          },
        ],
      } as unknown as PipelineConfig;

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        const err = e as HttpError;
        expect(err.body).toBe("task[1].metadata.thumbhash: must be a boolean");
      }
    });
  });

  describe("image source", () => {
    test("throws error when no image is provided", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig();

      await expect(executor.execute(config)).rejects.toThrow("No image provided");
    });

    test("throws error when URL fetching is disabled but URL is provided", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({ url: "https://example.com/image.jpg" });

      await expect(executor.execute(config)).rejects.toThrow(
        "URL fetching is disabled",
      );
    });

    test("uses imageData when provided", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig();
      const imageData = new Uint8Array([1, 2, 3, 4]);

      // This will fail at S3 upload but we can verify the flow
      try {
        await executor.execute(config, imageData);
      } catch {
        // Expected to fail at S3 upload
      }

      // Verify engine.perform was called (meaning validation passed and image data was used)
      expect(engine.perform).toHaveBeenCalled();
    });

    test("fetches URL when enableFetch is true and URL is provided", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: true,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({ url: "https://example.com/image.jpg" });

      // This will fail at S3 upload but we can verify the flow
      try {
        await executor.execute(config);
      } catch {
        // Expected to fail at S3 upload
      }

      // Verify client.fetch was called with the URL
      expect(client.fetch).toHaveBeenCalledWith("https://example.com/image.jpg");
    });
  });

  describe("metadata", () => {
    test("does not fetch metadata when not requested", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig();

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
      } catch {
        // Expected to fail at S3 upload
      }

      expect(engine.metadata).not.toHaveBeenCalled();
    });

    test("fetches metadata when requested", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        metadata: { exif: true, stats: false, thumbhash: true },
      });

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
      } catch {
        // Expected to fail at S3 upload
      }

      expect(engine.metadata).toHaveBeenCalledWith({
        data: expect.any(Uint8Array),
        exif: true,
        stats: false,
        thumbhash: true,
      });
    });

    test("uses default false values for missing metadata options", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        metadata: {},
      });

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
      } catch {
        // Expected to fail at S3 upload
      }

      expect(engine.metadata).toHaveBeenCalledWith({
        data: expect.any(Uint8Array),
        exif: false,
        stats: false,
        thumbhash: false,
      });
    });
  });

  describe("task execution", () => {
    test("calls engine.perform with correct transform options", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "task1",
            transform: {
              format: ImageType.Webp,
              width: 200,
              height: 150,
              quality: 85,
              blur: 5,
              greyscale: true,
              lossless: true,
              progressive: false,
              effort: 4,
              fit: "cover",
              kernel: "lanczos3",
              position: "center",
              preset: "quality",
            },
            output: { bucket: "test-bucket", key: "output.webp" },
          },
        ],
      });

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
      } catch {
        // Expected to fail at S3 upload
      }

      expect(engine.perform).toHaveBeenCalledWith({
        data: expect.any(Uint8Array),
        format: ImageType.Webp,
        width: 200,
        height: 150,
        quality: 85,
        blur: 5,
        greyscale: true,
        lossless: true,
        progressive: false,
        effort: 4,
        fit: "cover",
        kernel: "lanczos3",
        position: "center",
        preset: "quality",
      });
    });

    test("executes multiple tasks concurrently", async () => {
      const engine = createMockEngine();
      const client = createMockClient();
      const executor = new PipelineExecutor(
        engine as never,
        client as never,
        mockS3Config,
        {
          maxTasks: 10,
          enableFetch: false,
          dimensionLimit: DEFAULT_DIMENSION_LIMIT,
        },
      );

      const config = createValidConfig({
        tasks: [
          {
            id: "t1",
            transform: { format: ImageType.Jpeg },
            output: { bucket: "b", key: "k1.jpg" },
          },
          {
            id: "t2",
            transform: { format: ImageType.Png },
            output: { bucket: "b", key: "k2.png" },
          },
          {
            id: "t3",
            transform: { format: ImageType.Webp },
            output: { bucket: "b", key: "k3.webp" },
          },
        ],
      });

      try {
        await executor.execute(config, new Uint8Array([1, 2, 3]));
      } catch {
        // Expected to fail at S3 upload
      }

      // All three tasks should have been executed
      expect(engine.perform).toHaveBeenCalledTimes(3);
    });
  });
});
