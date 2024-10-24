# Using the `rust-musl-builder` as base image, instead of 
# the official Rust toolchain
FROM rust:1 AS chef
USER root
RUN apt update && apt upgrade -y 
RUN apt install -y g++-aarch64-linux-gnu libc6-dev-arm64-cross
RUN rustup target add aarch64-unknown-linux-gnu 
RUN rustup toolchain install stable-aarch64-unknown-linux-gnu
RUN cargo install cargo-chef
WORKDIR /app

FROM chef AS planner
COPY random-image-site-discord-bot/ .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder 
COPY --from=planner /app/recipe.json recipe.json
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++
# Build dependencies - this is the caching Docker layer!
RUN cargo chef cook --release --target aarch64-unknown-linux-gnu --recipe-path recipe.json
# Build  application
COPY random-image-site-discord-bot/ .
RUN cargo build --release --target aarch64-unknown-linux-gnu --bin random-image-site-discord-bot 

FROM arm64v8/amazonlinux AS runtime
COPY --from=builder /app/target/aarch64-unknown-linux-gnu/release/random-image-site-discord-bot /usr/local/bin/
RUN chmod +x /usr/local/bin/random-image-site-discord-bot && echo 'updated run permissions'
RUN ls -la /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/random-image-site-discord-bot"]

