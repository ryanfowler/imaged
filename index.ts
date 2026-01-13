import { Client } from "./lib/client.ts";
import { ImageEngine } from "./lib/image.ts";
import { Server } from "./lib/server.ts";

const client = new Client({ timeout_ms: 10_000, body_limit_bytes: 1 << 24 });
const engine = new ImageEngine(navigator.hardwareConcurrency);
console.log(`Sharp version ${ImageEngine.VERSIONS.sharp}`);
console.log(`Vips verison ${ImageEngine.VERSIONS.vips}`);

const server = new Server(client, engine);
const url = await server.serve(process.env.PORT);
console.log(`Listening on ${url}`);
