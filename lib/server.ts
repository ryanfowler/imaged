import { parseImageParams } from "./params";
import {
  Fetcher,
  ImageOptions,
  ImageService,
  ImageType,
  TlsConfig,
} from "./types";
import { run } from "./util";

import http2 from "http2";

import Router from "@koa/router";
import Koa from "koa";

const mimeTypes: { [_ in ImageType]: string } = {
  [ImageType.Jpeg]: "image/jpeg",
  [ImageType.Png]: "image/png",
  [ImageType.Tiff]: "image/tiff",
  [ImageType.WebP]: "image/webp",
};

export interface ServerConfig {
  fetcher: Fetcher;
  imageService: ImageService;
}

interface Closer {
  close: { (fn: () => void): void };
}

export class Server {
  private readonly app: Koa;
  private server?: Closer;
  private isShutdown = false;

  constructor(config: ServerConfig) {
    const { fetcher, imageService } = config;

    const router = new Router();
    router.get("/proxy/:url", imageHandler(fetcher, imageService));

    this.app = new Koa();
    this.app.use(router.routes());
  }

  listen = (port: number, tlsConfig?: TlsConfig, cb?: () => void): void => {
    if (!tlsConfig) {
      this.server = this.app.listen(port, cb);
      return;
    }
    this.server = http2
      .createSecureServer(tlsConfig, this.app.callback())
      .listen(port, cb);
  };

  // shutdown only _actually_ works with a non-http2 server.
  // See: https://github.com/nodejs/node/issues/18176
  shutdown = (): Promise<void> => {
    return new Promise((resolve) => {
      if (!this.server || this.isShutdown) {
        resolve();
        return;
      }
      this.isShutdown = true;
      this.server.close(() => {
        resolve();
      });
    });
  };
}

const imageHandler = (fetcher: Fetcher, imageService: ImageService) => {
  return async (ctx: Koa.ParameterizedContext): Promise<void> => {
    let params: ImageOptions;
    try {
      params = parseImageParams(ctx.URL.searchParams, ctx.get("accept"));
    } catch (error) {
      ctx.status = 400;
      ctx.body = `${error}`;
      return;
    }

    const url: string = ctx.params.url;
    const buf = await run(fetcher.fetch(url));
    if (buf.status === "rejected") {
      ctx.status = 400;
      ctx.body = `${buf.reason}`;
      return;
    }

    const out = await run(imageService.perform(buf.value, params));
    if (out.status === "rejected") {
      ctx.status = 400;
      ctx.body = `${out.reason}`;
      return;
    }

    const value = out.value;
    ctx.response.set({ "Content-Type": mimeTypes[params.format] });
    ctx.response.set({ "X-Image-Height": value.info.height.toString(10) });
    ctx.response.set({ "X-Image-Width": value.info.width.toString(10) });

    ctx.status = 200;
    ctx.body = value.data;
  };
};
