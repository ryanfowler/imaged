import { URLSearchParams } from "url";

import sharp from "sharp";
import { request } from "undici";

sharp.cache(false);

const timeout = 60_000;

const images = [
  {
    name: "jpeg",
    url: "https://user-images.githubusercontent.com/2668821/122620831-cec26080-d048-11eb-95a5-b6eaf986c13f.jpeg",
  },
];

const imageTypes = [
  {
    name: "jpeg",
    sharpFormat: "jpeg",
  },
  {
    name: "webp",
    sharpFormat: "webp",
  },
  {
    name: "png",
    sharpFormat: "png",
  },
  {
    name: "avif",
    sharpFormat: "heif",
  },
  {
    name: "tiff",
    sharpFormat: "tiff",
  },
];

images.forEach((value) => {
  imageTypes.forEach(async (imageType) => {
    test.concurrent(
      `input ${value.name} to output ${imageType.name}`,
      async () => {
        const metadata = await getImageMetadata(value.url, {
          format: encodeURIComponent(imageType.name),
          height: "200",
        });
        expect(metadata.format).toEqual(imageType.sharpFormat);
      },
      timeout
    );
  });
});

test.concurrent(
  `crop to specific height`,
  async () => {
    const metadata = await getImageMetadata(images[0].url, {
      height: "400",
    });
    expect(metadata.height).toEqual(400);
    expect(metadata.width).toEqual(533);
  },
  timeout
);

test.concurrent(
  `crop to specific width`,
  async () => {
    const metadata = await getImageMetadata(images[0].url, {
      width: "533",
    });
    expect(metadata.height).toEqual(400);
    expect(metadata.width).toEqual(533);
  },
  timeout
);

test.concurrent(
  `crop to specific height and width`,
  async () => {
    const metadata = await getImageMetadata(images[0].url, {
      height: "400",
      width: "400",
    });
    expect(metadata.height).toEqual(400);
    expect(metadata.width).toEqual(400);
  },
  timeout
);

async function getImageMetadata(
  imageUrl: string,
  options?: Record<string, string>
): Promise<sharp.Metadata> {
  let urlStr = `http://localhost:9000/proxy/${encodeURIComponent(imageUrl)}`;
  if (options) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) {
      query.set(key, value);
    }
    urlStr += `?${query.toString()}`;
  }
  const out = await fetch(urlStr);
  return sharp(out, { sequentialRead: true }).metadata();
}

async function fetch(url: string): Promise<Buffer> {
  const res = await request(url);
  if (res.statusCode !== 200) {
    throw new Error(`fetch: received response code '${res.statusCode}'`);
  }
  const out = [];
  for await (const data of res.body) {
    out.push(data);
  }
  return Buffer.concat(out);
}
