import { Semaphore } from "./semaphore";
import { Fetcher, RequestContext } from "./types";

import { request } from "undici";

interface ClientConfig {
  concurrency: number;
}

export class Client implements Fetcher {
  private readonly sema: Semaphore;

  constructor(config: ClientConfig) {
    this.sema = new Semaphore(config.concurrency);
  }

  close = (): void => {}; // eslint-disable-line

  fetch = async (ctx: RequestContext, url: string | URL): Promise<Buffer> => {
    const acquireEvent = ctx.recordEvent("acquire_fetch");
    await this.sema.acquire();
    acquireEvent.end();

    const fetchEvent = ctx.recordEvent("fetch");
    try {
      return await this.fetchInner(url);
    } finally {
      fetchEvent.end();
      this.sema.release();
    }
  };

  private fetchInner = async (url: string | URL): Promise<Buffer> => {
    const res = await request(url);
    if (res.statusCode !== 200) {
      throw new Error(`fetch: received response code '${res.statusCode}'`);
    }
    const out = [];
    for await (const data of res.body) {
      out.push(data);
    }
    return Buffer.concat(out);
  };
}
