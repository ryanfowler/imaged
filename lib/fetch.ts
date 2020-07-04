import { Semaphore } from "./semaphore";
import { Fetcher } from "./types";

import fetch from "node-fetch";

interface ClientConfig {
  concurrency: number;
}

export class Client implements Fetcher {
  private readonly sema: Semaphore;

  constructor(config: ClientConfig) {
    this.sema = new Semaphore(config.concurrency);
  }

  fetch = async (url: string): Promise<Buffer> => {
    await this.sema.acquire();
    try {
      return await this.fetchInner(url);
    } finally {
      this.sema.release();
    }
  };

  private fetchInner = async (url: string): Promise<Buffer> => {
    const res = await fetch(url, { timeout: 20000 });
    if (!res.ok) {
      throw new Error(`fetch: received response code '${res.status}'`);
    }
    return res.buffer();
  };
}
