import { Semaphore } from "./semaphore";
import { Fetcher, RequestContext } from "./types";

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
    const res = await fetch(url, {
      agent: this.agent,
      timeout: 20000,
      size: 1 << 27,
    });
    if (!res.ok) {
      throw new Error(`fetch: received response code '${res.status}'`);
    }
    return res.buffer();
  };

  private agent = (url: URL): http.Agent => {
    if (url.protocol === "http:") {
      return this.httpAgent;
    }
    return this.httpsAgent;
  };
}
