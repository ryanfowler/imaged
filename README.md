# imaged

A high-performance HTTP server for on-the-fly image processing. Upload an image or provide a URL, and imaged will resize, convert, apply effects, or extract metadata in milliseconds.

Built with [Bun](https://bun.sh) and powered by [Sharp](https://sharp.pixelplumbing.com/)/[libvips](https://www.libvips.org/) for fast, memory-efficient processing.

## Features

- **Transform images** — Resize, crop, blur, convert to greyscale, and change formats
- **Extract metadata** — Dimensions, EXIF data, image statistics, and [thumbhash](https://evanw.github.io/thumbhash/) placeholders
- **Wide format support** — AVIF, GIF, HEIC, JPEG, JPEG XL, PNG, SVG, TIFF, and WebP
- **Production ready** — Configurable concurrency, request limits, TLS, and structured logging

## Quick Start

```bash
bun install
bun run index.ts
```

The server starts at `http://localhost:8000`. Try it out:

```bash
# Resize an image to 400px wide and convert to WebP
curl -X PUT "http://localhost:8000/transform?width=400&format=webp" \
  --data-binary @photo.jpg -o thumbnail.webp

# Get image dimensions and EXIF data
curl -X PUT "http://localhost:8000/metadata?exif=true" \
  --data-binary @photo.jpg
```

## CLI Options

| Flag                          | Description                                 | Default     |
| ----------------------------- | ------------------------------------------- | ----------- |
| `-p, --port <number>`         | HTTP port to listen on                      | 8000        |
| `-H, --host <address>`        | HTTP host to bind to                        | -           |
| `-u, --unix <path>`           | Unix socket path (overrides port/host)      | -           |
| `-c, --concurrency <number>`  | Max concurrent image operations             | CPU cores   |
| `-b, --body-limit <bytes>`    | Max request body size in bytes              | 16,777,216  |
| `-x, --pixel-limit <pixels>`  | Max input image pixels                      | 100,000,000 |
| `-d, --dimension-limit <px>`  | Max output width/height in pixels           | 16,384      |
| `-f, --enable-fetch`          | Enable GET endpoints that fetch remote URLs | false       |
| `-a, --allowed-hosts <regex>` | Regex pattern for allowed fetch hosts       | -           |
| `-l, --log-format <format>`   | Log format: `json` or `text`                | text        |
| `-L, --log-level <level>`     | Log level: `debug`, `info`, `warn`, `error` | info        |
| `--tls-cert <path>`           | Path to TLS certificate file                | -           |
| `--tls-key <path>`            | Path to TLS private key file                | -           |

## API Reference

### Health Check

```
GET /healthz
```

Returns server version and supported formats. Useful for monitoring and capability detection.

```bash
curl http://localhost:8000/healthz
```

```json
{
  "version": "0.1.0",
  "runtime": "Bun 1.3.6",
  "sharp": "0.34.5",
  "vips": "8.17.3",
  "decoders": ["avif", "gif", "jpeg", "png", "svg", "tiff", "webp"],
  "encoders": ["avif", "gif", "jpeg", "png", "raw", "tiff", "webp"]
}
```

---

### Transform Image

Resize, convert, or apply effects to an image.

```
PUT /transform
GET /transform  (requires --enable-fetch)
```

#### Query Parameters

| Parameter     | Type    | Description                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------------- |
| `url`         | string  | Source image URL (GET only)                                                     |
| `format`      | string  | Output format: `avif`, `gif`, `heic`, `jpeg`, `jxl`, `png`, `tiff`, `webp`      |
| `width`       | number  | Target width in pixels                                                          |
| `height`      | number  | Target height in pixels                                                         |
| `quality`     | number  | Output quality (1-100)                                                          |
| `effort`      | number  | CPU effort for encoding (AVIF/HEIC: 0-9, GIF/PNG: 1-10, JXL: 1-9, WebP: 0-6)    |
| `blur`        | boolean | Apply blur effect                                                               |
| `greyscale`   | boolean | Convert to greyscale                                                            |
| `lossless`    | boolean | Use lossless compression (where supported)                                      |
| `progressive` | boolean | Use progressive encoding (JPEG/PNG)                                             |
| `fit`         | string  | Resize fit mode: `cover`, `contain`, `fill`, `inside`, `outside`                |
| `kernel`      | string  | Resize kernel: `nearest`, `linear`, `cubic`, `mitchell`, `lanczos2`, `lanczos3` |
| `position`    | string  | Crop position when using `cover` fit                                            |
| `preset`      | string  | Encoding preset: `default`, `quality`, `size`                                   |

#### Examples

**Resize an image to 300px width:**

```bash
curl -X PUT \
  "http://localhost:8000/transform?width=300" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.jpg
```

**Convert to WebP with 80% quality:**

```bash
curl -X PUT \
  "http://localhost:8000/transform?format=webp&quality=80" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.webp
```

**Resize and crop to 200x200 square:**

```bash
curl -X PUT \
  "http://localhost:8000/transform?width=200&height=200&fit=cover" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.jpg
```

**Apply greyscale and blur:**

```bash
curl -X PUT \
  "http://localhost:8000/transform?greyscale=true&blur=true" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.jpg
```

**Fetch and transform a remote image (requires `--enable-fetch`):**

```bash
curl "http://localhost:8000/transform?url=https://example.com/image.jpg&width=500&format=webp" \
  -o output.webp
```

#### Response Headers

| Header               | Description                     |
| -------------------- | ------------------------------- |
| `Content-Type`       | MIME type of the output image   |
| `X-Image-Width`      | Width of the output image       |
| `X-Image-Height`     | Height of the output image      |
| `X-Response-Time-Ms` | Processing time in milliseconds |

---

### Extract Metadata

Get image dimensions, EXIF data, statistics, or generate a thumbhash placeholder.

```
PUT /metadata
GET /metadata  (requires --enable-fetch)
```

#### Query Parameters

| Parameter   | Type    | Description                 |
| ----------- | ------- | --------------------------- |
| `url`       | string  | Source image URL (GET only) |
| `exif`      | boolean | Include EXIF metadata       |
| `stats`     | boolean | Include image statistics    |
| `thumbhash` | boolean | Generate thumbhash          |

#### Examples

**Get basic metadata:**

```bash
curl -X PUT \
  "http://localhost:8000/metadata" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg
```

**Response:**

```json
{
  "width": 1920,
  "height": 1080,
  "format": "jpeg"
}
```

**Get metadata with EXIF data:**

```bash
curl -X PUT \
  "http://localhost:8000/metadata?exif=true" \
  -H "Content-Type: image/jpeg" \
  --data-binary @photo.jpg
```

**Response:**

```json
{
  "width": 4032,
  "height": 3024,
  "format": "jpeg",
  "exif": {
    "make": "Apple",
    "model": "iPhone 14 Pro",
    "datetime": "2024-01-15T10:30:00-05:00",
    "exposure_time": 0.008,
    "f_number": 1.78,
    "focal_length": 6.86,
    "focal_length_35mm": 24,
    "iso": 50,
    "flash": "Did not fire",
    "exposure_program": "Normal program",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "altitude": 12.5
  }
}
```

EXIF fields include camera info (make, model, lens), capture settings (exposure, aperture, ISO, flash, metering), GPS data (coordinates, altitude, speed, direction), and metadata (description, artist, copyright). Only fields present in the image are returned.

**Generate thumbhash:**

```bash
curl -X PUT \
  "http://localhost:8000/metadata?thumbhash=true" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg
```

**Response:**

```json
{
  "width": 1920,
  "height": 1080,
  "format": "jpeg",
  "thumbhash": "3OcRJYB4d3h/iIeHeEh3eIhw+j3A"
}
```

## TLS

Enable HTTPS by providing a certificate and private key:

```bash
bun run index.ts --tls-cert cert.pem --tls-key key.pem
```

## Performance

Image processing is memory-intensive. For production deployments, use a high-performance allocator like [mimalloc](https://github.com/microsoft/mimalloc) or [jemalloc](https://github.com/jemalloc/jemalloc) to reduce memory fragmentation and improve throughput.

**macOS:**

```bash
brew install mimalloc
DYLD_INSERT_LIBRARIES=/opt/homebrew/lib/libmimalloc.dylib bun run index.ts
```

**Linux (Debian/Ubuntu):**

```bash
sudo apt install libmimalloc2
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libmimalloc.so bun run index.ts
```

**Linux (Alpine):**

```bash
apk add mimalloc
LD_PRELOAD=/usr/lib/libmimalloc.so bun run index.ts
```

If using [mimalloc](https://github.com/microsoft/mimalloc), you may want to investigate the following environment variables for your use case:

- `MIMALLOC_ALLOW_LARGE_OS_PAGES`
- `MIMALLOC_SEGMENT_CACHE`
- `MIMALLOC_PAGE_RESET`
- `MIMALLOC_PURGE_DELAY`

For libvips, you may be interested in the following environment variables:

- `VIPS_DISC_THRESHOLD`
- `VIPS_CONCURRENCY` (default of `1` used in imaged)

## Docker

```bash
make build    # Build the image
make run      # Start the server
```

To pass arguments to the container:

```bash
make run ARGS="--port=3000"
```

## Using System libvips

By default, Sharp bundles its own libvips. To use a system-installed version instead (useful for custom builds or additional format support):

```bash
rm -rf node_modules
SHARP_FORCE_GLOBAL_LIBVIPS=1 \
  BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER=1 \
  BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS=1 \
  bun install
```

## License

[MIT](./LICENSE)
