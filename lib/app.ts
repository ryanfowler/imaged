import config from "./config";
import { Client } from "./fetch";
import { logger } from "./logger";
import { Server } from "./server";
import { Sharp } from "./sharp";
import { onSignals } from "./signals";

import os from "os";

const numCpus = os.cpus().length;

const client = new Client({ concurrency: numCpus * 20 });
const sharp = new Sharp({ concurrency: numCpus });

const server = new Server({ fetcher: client, imageService: sharp });
server.listen(config.port, config.tlsConfig, () => {
  logger.info({ port: config.port }, "server listening");
});

onSignals(["SIGTERM", "SIGINT", "SIGHUP"]).then(async (signal) => {
  logger.info({ signal }, "received signal");
  const timeout = setTimeout(() => {
    logger.info({}, "timeout reached");
    process.exit(1); // eslint-disable-line
  }, 5000);
  client.close();
  await server.shutdown();
  logger.info({}, "goodbye");
  clearTimeout(timeout);
});
