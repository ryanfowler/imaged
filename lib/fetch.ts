import { Semaphore } from "./semaphore";
import { Fetcher, RequestContext } from "./types";

interface ClientConfig {
  concurrency: number;
}

export class Client implements Fetcher {
  private readonly sema: Semaphore;

  constructor(config: ClientConfig) {
    this.sema = new Semaphore(config.concurrency);
  }

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
    const res = await fetch(url);
    if (res.status !== 200) {
      throw new Error(`fetch: received response code '${res.status}'`);
    }
    return Buffer.from(await res.arrayBuffer());
  };
}
