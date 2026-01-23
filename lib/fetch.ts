import { HttpError } from "./types.ts";

import type { ReadableStreamReadResult } from "node:stream/web";

export class Client {
  private timeoutMs: number;
  private bodyLimitBytes: number;
  private allowedHosts?: RegExp;

  constructor(opts: { timeoutMs: number; bodyLimit: number; allowedHosts?: RegExp }) {
    this.timeoutMs = opts.timeoutMs;
    this.bodyLimitBytes = opts.bodyLimit;
    this.allowedHosts = opts.allowedHosts;
  }

  async fetch(url: string): Promise<Uint8Array> {
    this.validateHost(url);
    const res = await this.makeRequest(url);
    const reader = res.body!.getReader();

    // Use Content-Length for early rejection and optimal pre-allocation.
    const contentLength = res.headers.get("content-length");
    let expectedLength: number | null = null;
    if (contentLength) {
      const parsed = parseInt(contentLength, 10);
      // Validate Content-Length is a safe integer to prevent precision loss
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER) {
        expectedLength = parsed;
      }
    }

    if (expectedLength != null && expectedLength > this.bodyLimitBytes) {
      await reader.cancel();
      throw this.bodySizeLimitError();
    }

    // Read with pre-allocated buffer when Content-Length is known.
    if (expectedLength != null && expectedLength > 0) {
      return this.readWithKnownLength(reader, expectedLength);
    }

    // Stream into chunks when Content-Length is unknown.
    return this.readChunked(reader);
  }

  // Performs the HTTP request with timeout and validates the response.
  private async makeRequest(url: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new HttpError(400, "fetch: unable to make request");
    }

    if (res.status === 404) {
      throw new HttpError(404, "fetch: not found");
    }
    if (res.status < 200 || res.status >= 400) {
      throw new HttpError(502, `fetch: received status ${res.status}`);
    }
    if (!res.body) {
      throw new HttpError(400, "fetch: no body in response");
    }

    return res;
  }

  // Reads the response body into a pre-allocated buffer when Content-Length is known.
  private async readWithKnownLength(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    expectedLength: number,
  ): Promise<Uint8Array> {
    const buffer = new Uint8Array(expectedLength);
    let position = 0;

    while (true) {
      const { done, value } = await this.readChunk(reader);
      if (done) break;

      // Guard against server sending more data than Content-Length.
      if (position + value.length > expectedLength) {
        await reader.cancel();
        throw this.bodySizeLimitError();
      }

      buffer.set(value, position);
      position += value.length;
    }

    // Validate we received the expected amount of data.
    if (position !== expectedLength) {
      throw new HttpError(
        502,
        `fetch: received ${position} bytes but Content-Length was ${expectedLength}`,
      );
    }

    return buffer;
  }

  // Reads the response body in chunks when Content-Length is unknown.
  private async readChunked(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await this.readChunk(reader);
      if (done) break;

      chunks.push(value);
      totalLength += value.length;

      if (totalLength > this.bodyLimitBytes) {
        await reader.cancel();
        throw this.bodySizeLimitError();
      }
    }

    return concatChunks(chunks, totalLength);
  }

  // Reads a single chunk from the stream, wrapping errors appropriately.
  private async readChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    try {
      return await reader.read();
    } catch {
      throw new HttpError(502, "fetch: error reading response body");
    }
  }

  private bodySizeLimitError(): HttpError {
    return new HttpError(
      400,
      `fetch: response body size limit of ${this.bodyLimitBytes} bytes exceeded`,
    );
  }

  private validateHost(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpError(400, "fetch: invalid URL");
    }

    // Only allow http and https schemes
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new HttpError(400, "fetch: only http and https URLs are supported");
    }

    if (!this.allowedHosts) {
      return;
    }

    if (!this.allowedHosts.test(parsed.host)) {
      throw new HttpError(403, "fetch: host is not allowed");
    }
  }
}

// Concatenates multiple Uint8Array chunks into a single buffer.
function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  if (chunks.length === 1) {
    return chunks[0]!;
  }
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}
