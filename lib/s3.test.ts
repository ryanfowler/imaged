import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parseS3Config, getS3Url } from "./s3.ts";
import type { S3Config } from "./types.ts";

describe("parseS3Config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env["AWS_ACCESS_KEY_ID"];
    delete process.env["AWS_SECRET_ACCESS_KEY"];
    delete process.env["AWS_REGION"];
    delete process.env["AWS_ENDPOINT_URL"];
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  test("returns null when AWS_ACCESS_KEY_ID is missing", () => {
    process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
    expect(parseS3Config()).toBeNull();
  });

  test("returns null when AWS_SECRET_ACCESS_KEY is missing", () => {
    process.env["AWS_ACCESS_KEY_ID"] = "key";
    expect(parseS3Config()).toBeNull();
  });

  test("returns null when both credentials are missing", () => {
    expect(parseS3Config()).toBeNull();
  });

  test("returns config with default region when AWS_REGION is not set", () => {
    process.env["AWS_ACCESS_KEY_ID"] = "test-key";
    process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";

    const config = parseS3Config();
    expect(config).not.toBeNull();
    expect(config!.accessKeyId).toBe("test-key");
    expect(config!.secretAccessKey).toBe("test-secret");
    expect(config!.region).toBe("us-east-1");
    expect(config!.endpoint).toBeUndefined();
  });

  test("returns config with custom region", () => {
    process.env["AWS_ACCESS_KEY_ID"] = "test-key";
    process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";
    process.env["AWS_REGION"] = "eu-west-1";

    const config = parseS3Config();
    expect(config).not.toBeNull();
    expect(config!.region).toBe("eu-west-1");
  });

  test("returns config with custom endpoint", () => {
    process.env["AWS_ACCESS_KEY_ID"] = "test-key";
    process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";
    process.env["AWS_ENDPOINT_URL"] = "http://localhost:4566";

    const config = parseS3Config();
    expect(config).not.toBeNull();
    expect(config!.endpoint).toBe("http://localhost:4566");
  });

  test("returns complete config with all values", () => {
    process.env["AWS_ACCESS_KEY_ID"] = "my-key";
    process.env["AWS_SECRET_ACCESS_KEY"] = "my-secret";
    process.env["AWS_REGION"] = "ap-northeast-1";
    process.env["AWS_ENDPOINT_URL"] = "https://custom.s3.endpoint.com";

    const config = parseS3Config();
    expect(config).toEqual({
      accessKeyId: "my-key",
      secretAccessKey: "my-secret",
      region: "ap-northeast-1",
      endpoint: "https://custom.s3.endpoint.com",
    });
  });
});

describe("getS3Url", () => {
  test("generates standard AWS S3 URL", () => {
    const config: S3Config = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
    };

    const url = getS3Url(
      "my-bucket",
      "path/to/file.jpg",
      config.region,
      config.endpoint,
    );
    expect(url).toBe("https://my-bucket.s3.us-east-1.amazonaws.com/path/to/file.jpg");
  });

  test("generates URL with different region", () => {
    const config: S3Config = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "eu-west-2",
    };

    const url = getS3Url("test-bucket", "image.png", config.region, config.endpoint);
    expect(url).toBe("https://test-bucket.s3.eu-west-2.amazonaws.com/image.png");
  });

  test("generates custom endpoint URL", () => {
    const config: S3Config = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
      endpoint: "http://localhost:4566",
    };

    const url = getS3Url("my-bucket", "file.txt", config.region, config.endpoint);
    expect(url).toBe("http://localhost:4566/my-bucket/file.txt");
  });

  test("handles custom endpoint with trailing slash", () => {
    const config: S3Config = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
      endpoint: "http://localhost:4566/",
    };

    const url = getS3Url("my-bucket", "file.txt", config.region, config.endpoint);
    expect(url).toBe("http://localhost:4566/my-bucket/file.txt");
  });

  test("handles keys with special characters", () => {
    const config: S3Config = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-west-1",
    };

    const url = getS3Url(
      "bucket",
      "path/to/my file (1).jpg",
      config.region,
      config.endpoint,
    );
    expect(url).toBe(
      "https://bucket.s3.us-west-1.amazonaws.com/path/to/my file (1).jpg",
    );
  });

  test("handles empty key", () => {
    const config: S3Config = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
    };

    const url = getS3Url("bucket", "", config.region, config.endpoint);
    expect(url).toBe("https://bucket.s3.us-east-1.amazonaws.com/");
  });

  test("generates R2-compatible URL with custom endpoint", () => {
    const config: S3Config = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
      endpoint: "https://account-id.r2.cloudflarestorage.com",
    };

    const url = getS3Url(
      "my-r2-bucket",
      "images/photo.webp",
      config.region,
      config.endpoint,
    );
    expect(url).toBe(
      "https://account-id.r2.cloudflarestorage.com/my-r2-bucket/images/photo.webp",
    );
  });
});
