# syntax = docker/dockerfile:1.3

FROM rust:1.75-bookworm as builder
WORKDIR /imaged
COPY . .
RUN apt-get update && apt-get install -y meson nasm cmake
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/imaged/target \
    cargo build --locked --release && cp /imaged/target/release/imaged /bin/imaged

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /bin/imaged /
ENTRYPOINT ["/imaged"]
