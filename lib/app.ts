import config from "./config";
import { Client } from "./fetch";
import { Server } from "./server";
import { Sharp } from "./sharp";

import os from "os";

const numCpus = os.cpus().length;

const client = new Client({ concurrency: numCpus * 6 });
const sharp = new Sharp({ concurrency: numCpus });

const server = new Server({ fetcher: client, imageService: sharp });
server.listen(config.port, config.tlsConfig);
console.log(`Listening on port ${config.port}`);
