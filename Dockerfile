# syntax=docker/dockerfile:1.7

# Build bun application
FROM oven/bun:1.3-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun \
    bun install --frozen-lockfile --production

# Prune Sharp binaries for other platforms
ARG TARGETOS TARGETARCH
RUN <<EOF
    set -eux
    # Map Docker arch names to Sharp arch names
    case "${TARGETARCH}" in
        amd64) SHARP_ARCH="x64" ;;
        arm64) SHARP_ARCH="arm64" ;;
        *)     SHARP_ARCH="${TARGETARCH}" ;;
    esac
    
    for dir in node_modules/@img/sharp-*/; do
        name=$(basename "$dir")
        case "$name" in
            sharp-${TARGETOS}-${SHARP_ARCH}|sharp-libvips-${TARGETOS}-${SHARP_ARCH})
                echo "Kept: $name"
                ;;
            *)
                rm -rf "$dir"
                echo "Removed: $name"
                ;;
        esac
    done
EOF

# Prune unnecessary files in node_modules
RUN rm -rf node_modules/*/.git \
  node_modules/*/docs \
  node_modules/*/test \
  node_modules/*/tests \
  node_modules/*/*.md \
  node_modules/*/Makefile \
  node_modules/**/test \
  node_modules/**/tests

COPY . .

# Get runtime dependencies
FROM debian:trixie-slim AS libs
RUN apt-get update && apt-get install -y --no-install-recommends libmimalloc3 \
  && rm -rf /var/lib/apt/lists/* \
  && cp /usr/lib/*-linux-gnu/libmimalloc.so.3.0 /libmimalloc.so

# Runtime
FROM gcr.io/distroless/cc-debian13
WORKDIR /app

COPY --link --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY --link --from=build /app/index.ts /app/package.json /app/
COPY --link --from=build /app/lib /app/lib
COPY --link --from=build /app/node_modules /app/node_modules

COPY --link --from=libs /libmimalloc.so /usr/lib/libmimalloc.so
ENV LD_PRELOAD=/usr/lib/libmimalloc.so

ENTRYPOINT ["bun", "index.ts"]
