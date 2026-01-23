# syntax=docker/dockerfile:1.7

# Build bun application
FROM oven/bun:1.3-slim AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.bun \
    bun install --frozen-lockfile --production

# Get runtime dependencies
FROM debian:trixie-slim AS libs
RUN apt-get update && apt-get install -y --no-install-recommends libmimalloc3 \
  && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
  mkdir -p /out; \
  cp -a /usr/lib/*-linux-gnu/libmimalloc.so.3.0 /out/libmimalloc.so.3.0; \
  ln -sf libmimalloc.so.3.0 /out/libmimalloc.so.3

# Runtime
FROM gcr.io/distroless/cc-debian13
WORKDIR /app

COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY --from=build /app/index.ts /app/index.ts
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/lib /app/lib
COPY --from=build /app/node_modules /app/node_modules

COPY --from=libs /out/libmimalloc.so.3.0 /usr/lib/libmimalloc.so.3.0
COPY --from=libs /out/libmimalloc.so.3   /usr/lib/libmimalloc.so.3
ENV LD_PRELOAD=/usr/lib/libmimalloc.so.3

CMD ["bun", "index.ts"]
