# Configuration

imaged can be configured via CLI flags or environment variables. CLI flags take precedence over environment variables, which take precedence over defaults.

## CLI Options

| Flag                            | Description                                 | Default     |
| ------------------------------- | ------------------------------------------- | ----------- |
| `-p, --port <number>`           | HTTP port to listen on                      | 8000        |
| `-H, --host <address>`          | HTTP host to bind to                        | -           |
| `-u, --unix <path>`             | Unix socket path (overrides port/host)      | -           |
| `-c, --concurrency <number>`    | Max concurrent image operations             | CPU cores   |
| `-b, --body-limit <bytes>`      | Max request body size in bytes              | 16,777,216  |
| `-x, --pixel-limit <pixels>`    | Max input image pixels                      | 100,000,000 |
| `-d, --dimension-limit <px>`    | Max output width/height in pixels           | 16,384      |
| `-f, --enable-fetch`            | Enable GET endpoints that fetch remote URLs | false       |
| `-a, --allowed-hosts <regex>`   | Regex pattern for allowed fetch hosts       | -           |
| `    --disable-ssrf-protection` | Disable SSRF protection for fetch requests  | false       |
| `-P, --enable-pipeline`         | Enable the /pipeline endpoint (Bun only)    | false       |
| `    --max-pipeline-tasks <n>`  | Max tasks per pipeline request              | 10          |
| `-l, --log-format <format>`     | Log format: `json` or `text`                | text        |
| `-L, --log-level <level>`       | Log level: `debug`, `info`, `warn`, `error` | info        |
| `    --tls-cert <path>`         | Path to TLS certificate file                | -           |
| `    --tls-key <path>`          | Path to TLS private key file                | -           |

## Environment Variables

| Environment Variable      | CLI Equivalent              | Description                                 |
| ------------------------- | --------------------------- | ------------------------------------------- |
| `PORT`                    | `--port`                    | HTTP port to listen on                      |
| `HOST`                    | `--host`                    | HTTP host to bind to                        |
| `UNIX_SOCKET`             | `--unix`                    | Unix socket path                            |
| `CONCURRENCY`             | `--concurrency`             | Max concurrent image operations             |
| `BODY_LIMIT`              | `--body-limit`              | Max request body size in bytes              |
| `PIXEL_LIMIT`             | `--pixel-limit`             | Max input image pixels                      |
| `DIMENSION_LIMIT`         | `--dimension-limit`         | Max output width/height in pixels           |
| `ENABLE_FETCH`            | `--enable-fetch`            | Enable GET endpoints (`true`/`false`)       |
| `ALLOWED_HOSTS`           | `--allowed-hosts`           | Regex pattern for allowed fetch hosts       |
| `DISABLE_SSRF_PROTECTION` | `--disable-ssrf-protection` | Disable SSRF protection (`true`/`false`)    |
| `ENABLE_PIPELINE`         | `--enable-pipeline`         | Enable pipeline endpoint (`true`/`false`)   |
| `MAX_PIPELINE_TASKS`      | `--max-pipeline-tasks`      | Max tasks per pipeline request              |
| `LOG_FORMAT`              | `--log-format`              | Log format: `json` or `text`                |
| `LOG_LEVEL`               | `--log-level`               | Log level: `debug`, `info`, `warn`, `error` |
| `TLS_CERT`                | `--tls-cert`                | Path to TLS certificate file                |
| `TLS_KEY`                 | `--tls-key`                 | Path to TLS private key file                |

Boolean environment variables accept `true`, `1`, `false`, or `0`.

## Examples

**Using environment variables:**

```bash
PORT=3000 ENABLE_FETCH=true bun run index.ts
```

**CLI flags override environment variables:**

```bash
PORT=3000 bun run index.ts --port 8080  # Uses port 8080
```

**Docker with environment variables:**

```bash
docker run -p 3000:3000 -e PORT=3000 -e ENABLE_FETCH=1 ghcr.io/ryanfowler/imaged:latest
```

## TLS

Enable HTTPS by providing a certificate and private key:

```bash
bun run index.ts --tls-cert cert.pem --tls-key key.pem
```

Both `--tls-cert` and `--tls-key` must be provided together. The certificate file should contain the full chain if using an intermediate CA.

**Docker with TLS:**

```bash
docker run -p 8443:8000 \
  -v /path/to/certs:/certs:ro \
  ghcr.io/ryanfowler/imaged:latest \
  --tls-cert /certs/cert.pem --tls-key /certs/key.pem
```
