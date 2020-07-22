import config from "./config";
import { Client } from "./fetch";
import { Server } from "./server";
import { Sharp } from "./sharp";
import { onSignals } from "./signals";

import os from "os";

const numCpus = os.cpus().length;

const client = new Client({ concurrency: numCpus * 6 });
const sharp = new Sharp({ concurrency: numCpus });

const server = new Server({ fetcher: client, imageService: sharp });
server.listen(config.port, config.tlsConfig, () => {
  console.log(`Listening on port '${config.port}'`);
});

onSignals(["SIGTERM", "SIGINT", "SIGHUP"]).then(async (signal) => {
  console.log(`Recieved signal: '${signal}'`);
  const timeout = setTimeout(() => {
    console.log("Timeout reached!");
    process.exit(1); // eslint-disable-line
  }, 5000);
  client.close();
  await server.shutdown();
  console.log("Goodbye!");
  clearTimeout(timeout);
});
