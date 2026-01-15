import { Client } from "./lib/client.ts";
import { ImageEngine } from "./lib/image.ts";
import { getConcurrency, getRuntimeVersion, getVersion, Server } from "./lib/server.ts";

const bodyLimit = 1 << 24;
const concurrency = getConcurrency();
const client = new Client({ timeoutMs: 10_000, bodyLimit: bodyLimit });
const engine = new ImageEngine(concurrency);
console.log(`Version: ${getVersion()}`);
console.log(`Runtime: ${getRuntimeVersion()}`);
console.log(`Sharp: ${ImageEngine.VERSIONS.sharp}`);
console.log(`Vips: ${ImageEngine.VERSIONS.vips}`);
console.log(`Concurrency: ${concurrency}`);
console.log(`Decoders: ${JSON.stringify(engine.decoders)}`);
console.log(`Encoders: ${JSON.stringify(engine.encoders)}`);

const server = new Server(client, engine, bodyLimit);
const url = await server.serve();
console.log(`Listening on ${url}`);
