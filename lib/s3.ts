import { S3Client } from "bun";
import { type S3Config } from "./types.ts";

export function parseS3Config(): S3Config | null {
  const accessKeyId = process.env["AWS_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"];
  if (!accessKeyId || !secretAccessKey) return null;

  return {
    accessKeyId,
    secretAccessKey,
    region: process.env["AWS_REGION"] || "us-east-1",
    endpoint: process.env["AWS_ENDPOINT_URL"],
  };
}

export function getS3Url(
  bucket: string,
  key: string,
  region: string,
  endpoint?: string,
): string {
  if (endpoint) {
    // Custom endpoint: endpoint/bucket/key
    const base = endpoint.replace(/\/$/, "");
    return `${base}/${bucket}/${key}`;
  }
  // Standard AWS: https://bucket.s3.region.amazonaws.com/key
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export interface S3UploadOptions {
  contentType?: string;
  acl?: string;
}

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    endpoint: config.endpoint,
  });
}

export async function uploadToS3(
  data: Buffer,
  bucket: string,
  key: string,
  client: S3Client,
  options: S3UploadOptions,
): Promise<void> {
  const file = client.file(key, {
    bucket,
    acl: options.acl as undefined, // Hack the type system
    type: options.contentType,
  });

  await file.write(data);
}
