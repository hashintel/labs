# Multi-stage Dockerfile for HASH Core
# Stage 1: Build environment with Rust and Node.js
FROM node:20-bookworm as builder

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Add WebAssembly target for Rust
RUN rustup target add wasm32-unknown-unknown

# Install wasm-pack for WebAssembly compilation
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and scripts for dependency installation
COPY package.json yarn.lock ./
COPY packages/core/package.json ./packages/core/
COPY packages/engine-web/package.json ./packages/engine-web/
COPY packages/utils/package.json ./packages/utils/
COPY scripts/ ./scripts/

# Copy Rust manifests
COPY Cargo.toml ./
COPY packages/engine/Cargo.toml ./packages/engine/
COPY packages/engine-web/Cargo.toml ./packages/engine-web/
COPY packages/engine-types/Cargo.toml ./packages/engine-types/

# Install dependencies without postinstall scripts
RUN yarn install --frozen-lockfile --ignore-scripts

# Copy all source code
COPY . .

# Build utils and engine-web (required dependencies)
RUN yarn build:utils
RUN yarn build:engine-web

# Build the core application for production
FROM builder as core-builder
RUN yarn build:core

# Stage 2: Production image with nginx
FROM nginx:alpine as production

# Copy built application from core-builder stage
COPY --from=core-builder /app/packages/core/dist /usr/share/nginx/html

# Copy nginx configuration
COPY <<EOF /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Handle client-side routing
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss application/atom+xml image/svg+xml;

    # Set cache headers for static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
}
EOF

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

# Stage 3: Development image (optional)
FROM builder as development

WORKDIR /app

# Expose development port
EXPOSE 3000

# Start development server
CMD ["yarn", "serve:core"] 