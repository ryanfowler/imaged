import { RUNTIME_VERSION, VERSION, parseArgs } from "./lib/cli.ts";
import { Client } from "./lib/fetch.ts";
import { ImageEngine } from "./lib/image.ts";
import { createLogger } from "./lib/logger.ts";
import { PipelineExecutor } from "./lib/pipeline.ts";
import { Server } from "./lib/server.ts";

const opts = parseArgs();
const logger = createLogger(opts.logFormat, opts.logLevel);

const client = new Client({
  timeoutMs: 10_000,
  bodyLimit: opts.bodyLimit,
  allowedHosts: opts.allowedHosts,
  ssrfProtection: opts.ssrfProtection,
});
const engine = new ImageEngine({
  concurrency: opts.concurrency,
  pixelLimit: opts.pixelLimit,
});

logger.info({ version: VERSION }, "imaged");
logger.info({ version: RUNTIME_VERSION }, "runtime");
logger.info({ version: ImageEngine.VERSIONS.sharp }, "sharp");
logger.info({ version: ImageEngine.VERSIONS.vips }, "vips");
logger.info({ value: opts.concurrency }, "concurrency");
logger.info({ value: engine.decoders }, "decoders");
logger.info({ value: engine.encoders }, "encoders");

// Create pipeline executor if enabled
let pipelineExecutor: PipelineExecutor | undefined;
if (opts.enablePipeline && opts.s3Config) {
  pipelineExecutor = new PipelineExecutor(engine, client, opts.s3Config, {
    maxTasks: opts.maxPipelineTasks,
    enableFetch: opts.enableFetch,
    dimensionLimit: opts.dimensionLimit,
  });
  logger.info({ maxTasks: opts.maxPipelineTasks }, "pipeline enabled");
}

const server = new Server(client, engine, opts.bodyLimit, opts.dimensionLimit, logger);
const url = await server.serve({
  port: opts.port,
  host: opts.host,
  unix: opts.unix,
  enableFetch: opts.enableFetch,
  tlsCert: opts.tlsCert,
  tlsKey: opts.tlsKey,
  pipelineExecutor,
});
logger.info({ url }, "server listening");
