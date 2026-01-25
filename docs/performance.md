# Performance

Image processing is memory-intensive. This guide covers optimizations for production deployments.

## Memory Allocators

The default system allocator can cause memory fragmentation during heavy image processing. Using a high-performance allocator like [mimalloc](https://github.com/microsoft/mimalloc) or [jemalloc](https://github.com/jemalloc/jemalloc) significantly reduces fragmentation and improves throughput.

### mimalloc (Recommended)

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

### mimalloc Tuning

These environment variables can be used to tune mimalloc for your workload:

| Variable                        | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| `MIMALLOC_ALLOW_LARGE_OS_PAGES` | Enable large/huge pages for better TLB efficiency |
| `MIMALLOC_SEGMENT_CACHE`        | Number of segments to cache per thread            |
| `MIMALLOC_PAGE_RESET`           | Reset (decommit) pages when no longer used        |
| `MIMALLOC_PURGE_DELAY`          | Delay in ms before purging unused pages           |

### jemalloc Alternative

jemalloc is another excellent choice, especially for long-running servers:

**macOS:**

```bash
brew install jemalloc
DYLD_INSERT_LIBRARIES=/opt/homebrew/lib/libjemalloc.dylib bun run index.ts
```

**Linux (Debian/Ubuntu):**

```bash
sudo apt install libjemalloc2
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so bun run index.ts
```

## libvips Tuning

imaged uses [Sharp](https://sharp.pixelplumbing.com/) which is powered by [libvips](https://www.libvips.org/). These environment variables can tune libvips behavior:

| Variable              | Description                                            | Default in imaged |
| --------------------- | ------------------------------------------------------ | ----------------- |
| `VIPS_DISC_THRESHOLD` | Size in bytes before using temp files for large images | libvips default   |
| `VIPS_CONCURRENCY`    | Number of threads libvips uses internally              | 1                 |

imaged sets `VIPS_CONCURRENCY=1` by default because it manages concurrency at the request level via `--concurrency`. This prevents over-subscription when processing many images simultaneously.

**To increase libvips internal parallelism:**

```bash
VIPS_CONCURRENCY=4 bun run index.ts --concurrency 2
```

This would allow 2 concurrent image operations, each using up to 4 libvips threads.

## Concurrency Settings

The `--concurrency` flag limits how many images are processed simultaneously. The default is the number of CPU cores.

**Considerations:**

- **Memory**: Each concurrent operation needs memory for the image. Lower concurrency if hitting memory limits.
- **CPU**: Image encoding (especially AVIF) is CPU-intensive. Match concurrency to available cores.
- **I/O**: For workloads with lots of network fetching, higher concurrency can improve throughput.

```bash
# High-memory server, limit concurrent operations
bun run index.ts --concurrency 4

# CPU-bound workload on 8-core machine
bun run index.ts --concurrency 8
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

**When to use system libvips:**

- Need formats not in the bundled version (e.g., newer HEIC support)
- Want to use OS security updates for libvips
- Building custom libvips with specific plugins

## Docker Optimization

The official Docker image already includes mimalloc. Additional optimizations:

**Limit memory to prevent OOM:**

```bash
docker run -p 8000:8000 --memory 2g ghcr.io/ryanfowler/imaged:latest
```

**Set concurrency based on available CPUs:**

```bash
docker run -p 8000:8000 --cpus 4 ghcr.io/ryanfowler/imaged:latest --concurrency 4
```
