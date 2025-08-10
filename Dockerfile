# syntax=docker/dockerfile:1.7-labs
FROM node:20-bookworm AS builder

# Rust toolchain for WASM
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup target add wasm32-unknown-unknown
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# System deps
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Yarn setup & cache
ENV YARN_CACHE_FOLDER=/usr/local/share/.cache/yarn
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
RUN yarn config set network-timeout 600000 -g

# Copy manifests
COPY package.json yarn.lock ./
COPY packages/core/package.json ./packages/core/
COPY packages/engine-web/package.json ./packages/engine-web/
COPY packages/utils/package.json ./packages/utils/
COPY scripts/ ./scripts/

# Rust manifests
COPY Cargo.toml ./
COPY packages/engine/Cargo.toml ./packages/engine/
COPY packages/engine-web/Cargo.toml ./packages/engine-web/
COPY packages/engine-types/Cargo.toml ./packages/engine-types/

# Install deps (ignore postinstall scripts)
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --ignore-scripts --prefer-offline

# Copy full source
COPY . .

# Build workspaces that provide compiled outputs needed at runtime
# We installed with --ignore-scripts earlier for caching speed, so run builds now
RUN yarn build:utils && yarn build:engine-web

# --- Dev/server image ---
FROM builder AS yarn-server
WORKDIR /app
EXPOSE 3000
CMD ["yarn", "serve:core"]
