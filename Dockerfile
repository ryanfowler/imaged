# syntax=docker/dockerfile:1.7

############################
# 1) Build (dev deps allowed here)
############################
FROM oven/bun:debian AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun \
    bun install --frozen-lockfile

COPY . .

############################
# 2) Production dependencies only
############################
FROM oven/bun:debian AS prod-deps
WORKDIR /app

COPY package.json bun.lock* ./
RUN --mount=type=cache,target=/root/.bun \
    bun install --frozen-lockfile --production


############################
# 3) Get runtime libraries
############################
FROM debian:trixie-slim AS libs
RUN apt-get update && apt-get install -y --no-install-recommends \
      libmimalloc3 libstdc++6 libgcc-s1 \
    && rm -rf /var/lib/apt/lists/*

# Create output dir, then copy the .so's and add a stable symlink name.
RUN set -eux; \
    mkdir -p /out; \
    cp -a /usr/lib/*-linux-gnu/libmimalloc.so.3.0 /out/libmimalloc.so.3.0; \
    ln -sf libmimalloc.so.3.0 /out/libmimalloc.so.3; \
    STDCPP="$(dpkg -L libstdc++6 | grep -m1 -E '/libstdc\+\+\.so\.6$')"; \
    GCCS="$(dpkg -L libgcc-s1   | grep -m1 -E '/libgcc_s\.so\.1$')"; \
    cp -aL "$STDCPP" /out/libstdc++.so.6; \
    cp -aL "$GCCS"   /out/libgcc_s.so.1

############################
# 4) Distroless runtime
############################
FROM oven/bun:distroless
WORKDIR /app

COPY --from=build /app/index.ts /app/index.ts
COPY --from=build /app/lib /app/lib

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/package.json /app/package.json
COPY --from=prod-deps /app/bun.lock* /app/

COPY --from=libs /out/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=libs /out/libgcc_s.so.1  /lib/libgcc_s.so.1

COPY --from=libs /out/libmimalloc.so.3.0 /usr/lib/libmimalloc.so.3.0
COPY --from=libs /out/libmimalloc.so.3   /usr/lib/libmimalloc.so.3
ENV LD_PRELOAD=/usr/lib/libmimalloc.so.3

CMD ["./index.ts"]
