import { resolveHostname, isPrivateIP, parseIPv4, parseIPv6 } from "./ssrf.ts";
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
  // DNS resolution and SSRF validation are done atomically to prevent DNS rebinding.
  private async makeRequest(url: string): Promise<Response> {
    const parsed = this.validateUrl(url);

    // Resolve hostname to IP and validate for SSRF in one atomic step.
    // The request is then made directly to the validated IP.
    const { targetUrl, host } = await this.resolveAndValidate(parsed);

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
        headers: {
          Host: host,
        },
      });
    } catch {
      throw new HttpError(400, "fetch: unable to make request");
    }

    return res;
  }

  // Resolves hostname to IP and validates it for SSRF.
  // Returns a URL with the IP address and the original host for the Host header.
  // This ensures DNS resolution and validation happen atomically - no TOCTTOU.
  private async resolveAndValidate(
    parsed: URL,
  ): Promise<{ targetUrl: string; host: string }> {
    const hostname = parsed.hostname;

    // If SSRF protection is disabled, just return the original URL
    if (!this.ssrfProtection) {
      return { targetUrl: parsed.toString(), host: parsed.host };
    }

    // Check if hostname is already an IP address
    const isIPv4 = parseIPv4(hostname) !== null;
    const cleanedHostname = hostname.replace(/^\[|\]$/g, "");
    const isIPv6 = parseIPv6(cleanedHostname) !== null;

    if (isIPv4 || isIPv6) {
      // Direct IP address - validate it
      const ip = isIPv6 ? cleanedHostname : hostname;
      const result = isPrivateIP(ip);
      if (result.isPrivate) {
        throw new HttpError(
          403,
          `fetch: host resolves to private IP (${result.reason})`,
        );
      }
      return { targetUrl: parsed.toString(), host: parsed.host };
    }

    // Resolve hostname to IP addresses
    const ips = await resolveHostname(hostname);

    // Find the first non-private IP
    for (const ip of ips) {
      const result = isPrivateIP(ip);
      if (!result.isPrivate) {
        // Build URL with IP address instead of hostname
        const targetUrl = this.buildUrlWithIP(parsed, ip);
        return { targetUrl, host: parsed.host };
      }
    }

    // All IPs are private
    throw new HttpError(403, "fetch: host resolves to private IP");
  }

  // Builds a URL replacing the hostname with an IP address.
  private buildUrlWithIP(original: URL, ip: string): string {
    // Handle IPv6 addresses - they need brackets in URLs
    const hostPart = ip.includes(":") ? `[${ip}]` : ip;

    // Reconstruct URL with IP
    let url = `${original.protocol}//${hostPart}`;

    // Add port if non-default
    if (original.port) {
      url += `:${original.port}`;
    }

    // Add path, search, and hash
    url += original.pathname + original.search + original.hash;

    return url;
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

  // Validates URL scheme and allowed hosts (does not do SSRF IP validation).
  private validateUrl(url: string): URL {
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

    // Check allowed hosts regex
    if (this.allowedHosts && !this.allowedHosts.test(parsed.host)) {
      throw new HttpError(403, "fetch: host is not allowed");
    }

    return parsed;
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
