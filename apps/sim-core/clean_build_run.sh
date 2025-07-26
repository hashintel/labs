#!/bin/bash
# clean_build_run.sh
#
# Cleans, builds, and runs the sim-core application from scratch.
#
# Usage:
#   bash clean_build_run.sh
#
# This script must be run from the apps/sim-core directory.

set -e

# Clean all build artifacts and dependencies
echo "Cleaning node_modules, yarn.lock, target, dist..."
rm -rf node_modules yarn.lock target dist
find packages -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find packages -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
find packages -name "target" -type d -exec rm -rf {} + 2>/dev/null || true

# Clean Rust build cache
echo "Cleaning Cargo cache..."
cargo clean

# Install dependencies
echo "Installing dependencies..."
yarn install

# Build the core application
echo "Building core application..."
yarn build:core

# Start the development server
echo "Starting development server..."
yarn serve:core 