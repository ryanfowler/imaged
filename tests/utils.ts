import { URLSearchParams } from "url";

import sharp from "sharp";

sharp.cache(false);

const port = process.env.PORT ?? "9000";
const host = process.env.HOST ?? "localhost";

export async function getImageMetadata(
  imageUrl: string,
  options?: Record<string, string>
): Promise<sharp.Metadata> {
  let urlStr = `http://${host}:${port}/proxy/${encodeURIComponent(imageUrl)}`;
  if (options) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      query.set(key, value);
    }
    urlStr += `?${query.toString()}`;
  }
  const out = await fetch_image(urlStr);
  return sharp(out, { sequentialRead: true }).metadata();
}

async function fetch_image(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (res.status !== 200) {
    throw new Error(`fetch: received response code '${res.status}'`);
  }
  return Buffer.from(await res.arrayBuffer());
}
