#!/usr/bin/env bash
set -euo pipefail

# Seed graph types, create org entities, run the watermark demo.
# Expects: HASH graph on localhost:4000, admin on :4001, Postgres demo DB on :5432.

cd "$(dirname "$0")"

BG_PID=0
cleanup() {
  if [ "$BG_PID" -ne 0 ]; then
    kill -INT $BG_PID 2>/dev/null || true
    sleep 1
    wait $BG_PID 2>/dev/null || true
  fi
}
trap cleanup EXIT

stop_bg() {
  if [ "$BG_PID" -ne 0 ]; then
    kill -INT $BG_PID 2>/dev/null || true
    sleep 1
    wait $BG_PID 2>/dev/null || true
    BG_PID=0
  fi
}

echo "=== seed graph ==="
eval "$(npx tsx src/e2e/seed-graph.ts 2>&1 | grep '^export HASH_')"

echo "=== seed orgs ==="
npx tsx src/e2e/seed-orgs.ts 1 2

echo "=== run demo ==="
npx tsx src/demo.ts "${1:-integration-watermark.json}" > /tmp/demo.log 2>&1 &
BG_PID=$!
sleep 3
stop_bg
echo "--- demo output ---"
cat /tmp/demo.log

echo "=== graph entities ==="
npx tsx src/e2e/view-graph.ts
