# imaged

A high-performance HTTP server for on-the-fly and batch image processing. Upload an image or provide a URL, and imaged will resize, convert, apply effects, or extract metadata in milliseconds.

Built with [Bun](https://bun.sh) and powered by [Sharp](https://sharp.pixelplumbing.com/)/[libvips](https://www.libvips.org/) for fast, memory-efficient processing.

## Features

- **[Transform images](docs/api/transform.md)** — Resize, crop, blur, convert formats, and apply effects
- **[Extract metadata](docs/api/metadata.md)** — Dimensions, EXIF data, image statistics, and thumbhash placeholders
- **[Batch processing](docs/api/pipeline.md)** — Process one image into multiple outputs and upload to S3
- **[Production ready](docs/configuration.md)** — Configurable concurrency, request limits, TLS, and structured logging

## Quick Start

### Docker

```bash
docker pull ghcr.io/ryanfowler/imaged:latest
docker run -p 8000:8000 ghcr.io/ryanfowler/imaged:latest
```

### From Source

```bash
git clone https://github.com/ryanfowler/imaged.git
cd imaged && bun install
bun run index.ts
```

## Try It Out

```bash
# Resize to 400px wide, convert to WebP
curl -X PUT "http://localhost:8000/transform?width=400&format=webp" \
  --data-binary @photo.jpg -o thumbnail.webp

# Get image dimensions and EXIF data
curl -X PUT "http://localhost:8000/metadata?exif=true" \
  --data-binary @photo.jpg

# Apply blur and greyscale
curl -X PUT "http://localhost:8000/transform?blur=true&greyscale=true" \
  --data-binary @photo.jpg -o blurred.jpg
```

## Documentation

### API Reference

- **[Transform](docs/api/transform.md)** — Resize, convert, crop, blur, and apply effects
- **[Metadata](docs/api/metadata.md)** — Extract dimensions, EXIF, stats, and thumbhash
- **[Pipeline](docs/api/pipeline.md)** — Batch processing with S3 upload

### Guides

- **[Configuration](docs/configuration.md)** — CLI flags, environment variables, TLS setup
- **[Security](docs/security.md)** — SSRF protection, host allowlists
- **[Performance](docs/performance.md)** — Memory allocators, libvips tuning

## Health Check

```bash
curl http://localhost:8000/healthz
```

Which returns general server information like:

```json
{
  "version": "0.2.0",
  "runtime": "Bun 1.3.6",
  "sharp": "0.34.5",
  "vips": "8.17.3",
  "decoders": ["avif", "gif", "jpeg", "png", "svg", "tiff", "webp"],
  "encoders": ["avif", "gif", "jpeg", "png", "raw", "tiff", "webp"]
}
```

## Supported Formats

The supported formats depends on the libvips that you are using. If you are using the bundled libvips, the supported formats are:

**Input**: AVIF, GIF, JPEG, PNG, SVG, TIFF, WebP

**Output**: AVIF, GIF, JPEG, PNG, RAW, TIFF, WebP

If using a [globally installed libvips](./docs/performance.md#using-system-libvips), your server _may_ support:

**Input**: AVIF, GIF, HEIC, JPEG, JPEG XL, PDF, PNG, SVG, TIFF, WebP

**Output**: AVIF, GIF, HEIC, JPEG, JPEG XL, PNG, RAW, TIFF, WebP

## License

[MIT](./LICENSE)
