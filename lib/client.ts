import { HttpError } from "./types.ts";

export class Client {
  private timeout_ms: number;
  private body_limit_bytes: number;

  constructor(ops: { timeoutMs: number; bodyLimitBytes: number }) {
    this.timeout_ms = ops.timeoutMs;
    this.body_limit_bytes = ops.bodyLimitBytes;
  }

  async fetch(url: string): Promise<Uint8Array> {
    let res;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(this.timeout_ms),
      });
    } catch (err) {
      if (err instanceof Error) {
        throw new HttpError(400, `fetch: unable to make request: ${err.message}`);
      }
      throw new HttpError(400, `fetch: unable to make request: ${err}`);
    }

    if (res.status < 200 || res.status >= 400) {
      if (res.status === 404) {
        throw new HttpError(404, "fetch: not found");
      }
      throw new HttpError(502, `fetch: received status ${res.status}`);
    }

    if (!res.body) {
      throw new HttpError(400, "fetch: no body in response");
    }

    const reader = res.body.getReader();
    let receivedLength = 0;
    const chunks = [];

    while (true) {
      let data;
      try {
        data = await reader.read();
      } catch (err) {
        if (err instanceof Error) {
          throw new HttpError(502, `fetch: reading response body: ${err.message}`);
        }
        throw new HttpError(502, `fetch: reading response body: ${err}`);
      }

      if (data.done) break;

      chunks.push(data.value);
      receivedLength += data.value.length;

      if (receivedLength > this.body_limit_bytes) {
        // Stop the stream and the network request
        reader.cancel();
        const limit = this.body_limit_bytes;
        throw new HttpError(
          400,
          `fetch: response body size limit of ${limit} bytes exceeded`,
        );
      }
    }

    // Shortcut for when a single chunk was received
    if (chunks.length === 1) {
      return chunks[0];
    }

    // Combine chunks into a single ArrayBuffer
    const fullUint8Array = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      fullUint8Array.set(chunk, position);
      position += chunk.length;
    }

    return fullUint8Array;
  }
}
