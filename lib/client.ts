export class Client {
  private timeout_ms: number;
  private body_limit_bytes: number;

  constructor(timeout_ms: number, body_limit_bytes: number) {
    this.timeout_ms = timeout_ms;
    this.body_limit_bytes = body_limit_bytes;
  }

  async fetch(url: string): Promise<Uint8Array> {
    let res;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(this.timeout_ms),
      });
    } catch (err) {
      throw new Response(`fetch: unable to make request: ${err}`, {
        status: 400,
      });
    }

    if (res.status < 200 || res.status >= 400) {
      if (res.status === 404) {
        throw new Response(`fetch: not found`, { status: 404 });
      }
      throw new Response(`fetch: received status: ${res.status}`, {
        status: 502,
      });
    }

    if (!res.body) {
      throw new Response("fetch: no body in response", { status: 400 });
    }

    const reader = res.body.getReader();
    let receivedLength = 0;
    const chunks = [];

    while (true) {
      let data;
      try {
        data = await reader.read();
      } catch (err) {
        throw new Response(`fetch: reading body: ${err}`, { status: 400 });
      }

      if (data.done) break;

      chunks.push(data.value);
      receivedLength += data.value.length;

      if (receivedLength > this.body_limit_bytes) {
        // Stop the stream and the network request
        reader.cancel();
        throw new Response(
          `Response size limit of ${this.body_limit_bytes} bytes exceeded.`,
          { status: 400 },
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
