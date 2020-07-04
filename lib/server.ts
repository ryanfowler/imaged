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

export class Server {
  private readonly app: Koa;
  private readonly fetcher: Fetcher;
  private readonly imageService: ImageService;

  constructor(config: ServerConfig) {
    this.fetcher = config.fetcher;
    this.imageService = config.imageService;

    const router = new Router();
    router.get("/image/:url", this.imageHandler);

    this.app = new Koa();
    this.app.use(router.routes());
  }

  private imageHandler = async (
    ctx: Koa.ParameterizedContext
  ): Promise<void> => {
    let url: string;
    let params: ImageOptions;
    try {
      url = Buffer.from(ctx.params.url, "base64").toString("utf-8");
      params = parseImageParams(ctx.query, ctx.get("accept"));
    } catch (error) {
      ctx.status = 400;
      ctx.body = `${error}`;
      return;
    }

    const buf = await run(this.fetcher.fetch(url));
    if (buf.status === "rejected") {
      ctx.status = 400;
      ctx.body = `${buf.reason}`;
      return;
    }

    const out = await run(this.imageService.perform(buf.value, params));
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

  listen = (port: number, tlsConfig?: TlsConfig): void => {
    if (!tlsConfig) {
      this.app.listen(port);
      return;
    }
    http2
      .createSecureServer(
        { key: tlsConfig.key, cert: tlsConfig.cert },
        this.app.callback()
      )
      .listen(port);
  };
}
