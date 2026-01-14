import { Client } from "./lib/client.ts";
import { ImageEngine } from "./lib/image.ts";
import { getConcurrency, getVersion, Server } from "./lib/server.ts";

const concurrency = getConcurrency();
const client = new Client({ timeout_ms: 10_000, body_limit_bytes: 1 << 24 });
const engine = new ImageEngine(concurrency);
console.log(`Version: ${getVersion()}`);
console.log(`Concurrency: ${concurrency}`);
console.log(`Sharp: ${ImageEngine.VERSIONS.sharp}`);
console.log(`Vips: ${ImageEngine.VERSIONS.vips}`);
console.log(`Decoders: ${JSON.stringify(engine.decoders)}`);
console.log(`Encoders: ${JSON.stringify(engine.encoders)}`);

const server = new Server(client, engine);
const url = await server.serve();
console.log(`Listening on ${url}`);
