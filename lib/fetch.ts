import { validateUrlForSSRF } from "./ssrf.ts";
import { HttpError } from "./types.ts";

type ReadResult<T> = { done: false; value: T } | { done: true; value?: T };

interface StreamReader<T> {
  read(): Promise<ReadResult<T>>;
  cancel(): Promise<void>;
}

const MAX_REDIRECTS = 10;

export class Client {
  private timeoutMs: number;
  private bodyLimitBytes: number;
  private allowedHosts?: RegExp;
  private ssrfProtection: boolean;

  constructor(opts: {
    timeoutMs: number;
    bodyLimit: number;
    allowedHosts?: RegExp;
    ssrfProtection?: boolean;
  }) {
    this.timeoutMs = opts.timeoutMs;
    this.bodyLimitBytes = opts.bodyLimit;
    this.allowedHosts = opts.allowedHosts;
    this.ssrfProtection = opts.ssrfProtection ?? true;
  }

  async fetch(url: string): Promise<Uint8Array> {
    const res = await this.fetchWithRedirects(url);
    const reader: StreamReader<Uint8Array> = res.body!.getReader();

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

  // Performs HTTP request with redirect validation.
  // Handles redirects manually to validate each destination for SSRF.
  private async fetchWithRedirects(url: string): Promise<Response> {
    let currentUrl = url;
    let redirectCount = 0;

    while (true) {
      // Validate host before each request (initial + redirects)
      await this.validateHost(currentUrl);

      const res = await this.makeRequest(currentUrl);

      // Check for redirect responses
      if (res.status >= 300 && res.status < 400) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new HttpError(400, "fetch: too many redirects");
        }

        const location = res.headers.get("location");
        if (!location) {
          throw new HttpError(502, "fetch: redirect response missing location header");
        }

        // Resolve relative URLs against current URL
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          throw new HttpError(502, "fetch: invalid redirect location");
        }

        redirectCount++;
        continue;
      }

      // Validate final response
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
  }

  // Performs a single HTTP request with timeout and manual redirect handling.
  private async makeRequest(url: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
      });
    } catch {
      throw new HttpError(400, "fetch: unable to make request");
    }

    return res;
  }

  // Reads the response body into a pre-allocated buffer when Content-Length is known.
  private async readWithKnownLength(
    reader: StreamReader<Uint8Array>,
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
  private async readChunked(reader: StreamReader<Uint8Array>): Promise<Uint8Array> {
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
    reader: StreamReader<Uint8Array>,
  ): Promise<ReadResult<Uint8Array>> {
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

  private async validateHost(url: string): Promise<void> {
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

    // Check allowed hosts regex.
    // Note: parsed.host is limited to 253 chars by DNS spec, providing
    // defense-in-depth against ReDoS even if a problematic pattern slips through.
    if (this.allowedHosts && !this.allowedHosts.test(parsed.host)) {
      throw new HttpError(403, "fetch: host is not allowed");
    }

    // SSRF protection: validate IP addresses
    if (this.ssrfProtection) {
      await validateUrlForSSRF(parsed);
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
