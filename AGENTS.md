# CLAUDE.md

## Project Overview

**imaged** is a high-performance HTTP server for on-the-fly image processing built with Bun and TypeScript. It uses Sharp (libvips) for image operations and Fastify as the HTTP framework. It supports image transformation (resize, crop, blur, format conversion), metadata extraction (EXIF, stats, thumbhash), and batch processing with S3 upload via a pipeline endpoint.

## Common Commands

```bash
bun install                     # Install dependencies
bun run index.ts                # Run the server locally
bun test                        # Run all tests
bun test lib/image.test.ts      # Run a single test file
bun run format                  # Format code with Prettier
bunx prettier . --check         # Check formatting without writing
bun run --bun tsc --noEmit      # Type check
make build                      # Build Docker image
make run                        # Run in Docker
```

CI runs: format check → type check → tests → server startup verification.

## Architecture

All application source lives in `lib/`. Tests are co-located as `*.test.ts` files.

**Entry point:** `index.ts` — parses CLI args, creates core components (ImageEngine, Client, Server), and starts listening.

**Key modules:**

- **server.ts** — Fastify HTTP server with endpoints: `GET/PUT /transform`, `GET/PUT /metadata`, `PUT /pipeline`, `GET /healthz`. Parses query/header parameters and delegates to ImageEngine.
- **image.ts** — `ImageEngine` class wrapping Sharp. Handles format detection via magic bytes, image transformation, and metadata extraction. Uses a Semaphore for concurrency control (defaults to CPU core count).
- **validation.ts** — Two-mode validation: lenient (default, warnings in response headers) and strict (`?strict=true`, returns errors). Handles parameter parsing, normalization, and range clamping.
- **fetch.ts** — `Client` class for fetching images by URL with redirect following and SSRF protection.
- **pipeline.ts** — `PipelineExecutor` for batch processing: transforms a single image into multiple outputs and uploads to S3 concurrently.
- **ssrf.ts** — IP validation to block private/reserved ranges (IPv4 and IPv6).
- **semaphore.ts** — Ring-buffer-based semaphore for limiting concurrent Sharp operations.
- **cli.ts** — CLI argument parsing with Commander.js. All flags have corresponding environment variable overrides.
- **presets.ts** — Quality presets (`default`, `quality`, `size`) with format-specific settings.
- **types.ts** — Shared TypeScript interfaces and types.

**Data flow:** HTTP Request → Server (param parsing) → Validation → Client (URL fetch if needed) → ImageEngine (process) → Response (or S3 upload for pipeline).

## Code Conventions

- **Runtime:** Bun (not Node.js). Use `bun:test` for testing (`describe`, `test`, `expect`).
- **TypeScript:** Strict mode with `noUnusedLocals` and `noUnusedParameters` enabled.
- **Formatting:** Prettier with 88-char print width.
- **Sharp config:** Cache disabled (`sharp.cache(false)`), concurrency set to 1 per-operation (global concurrency managed by Semaphore).
- **Error handling:** Custom `HttpError` class with HTTP status codes. No stack traces in responses.
