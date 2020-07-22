import { Semaphore } from "./semaphore";
import { Fetcher } from "./types";

import * as http from "http";
import * as https from "https";

import fetch from "node-fetch";

interface ClientConfig {
  concurrency: number;
}

export class Client implements Fetcher {
  private readonly sema: Semaphore;

  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor(config: ClientConfig) {
    this.sema = new Semaphore(config.concurrency);

    const agentOps = {
      keepAlive: true,
      keepAliveMsecs: 10000,
    };
    this.httpAgent = new http.Agent(agentOps);
    this.httpsAgent = new https.Agent(agentOps);
  }

  close = (): void => {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  };

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
