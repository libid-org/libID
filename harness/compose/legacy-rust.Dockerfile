# The released 0.2.0 pair rejects a clean mux close during final verification.
# Backport the upstream fix to both binaries without changing their locked
# dependency graph or the wire format used by the legacy backend and contracts.
FROM rust:1.97-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev git \
    && rm -rf /var/lib/apt/lists/*
ADD https://github.com/libid-org/keeper/archive/35538d252f84b630c951bf002e809af77d05df08.tar.gz /keeper.tar.gz
ADD https://github.com/libid-org/notary/archive/c55efeb9830ba78796d7f98f183abffe78a58101.tar.gz /notary.tar.gz
RUN mkdir -p /src/keeper /src/notary \
    && tar -xzf /keeper.tar.gz --strip-components=1 -C /src/keeper \
    && tar -xzf /notary.tar.gz --strip-components=1 -C /src/notary \
    && cargo fetch --locked --manifest-path /src/keeper/Cargo.toml \
    && cargo fetch --locked --manifest-path /src/notary/Cargo.toml
COPY compose/session-driver.patch /session-driver.patch
RUN for source in "$CARGO_HOME"/git/checkouts/libid-rs-*/ec71e15; do \
        git -C "$source" apply /session-driver.patch || exit 1; \
    done \
    && cargo build --locked --release --manifest-path /src/keeper/Cargo.toml --target-dir /target --bin keeper \
    && cargo build --locked --release --manifest-path /src/notary/Cargo.toml --target-dir /target --bin notary

# Preserve the release images' entrypoints, libraries and health checks.
FROM ghcr.io/libid-org/notary:0.2.0 AS notary
COPY --from=build /target/release/notary /usr/local/bin/notary

FROM ghcr.io/libid-org/keeper:0.2.0 AS keeper
COPY --from=build /target/release/keeper /usr/local/bin/keeper
