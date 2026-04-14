#!/usr/bin/env bash
set -euo pipefail
# e2e: batch sync + CDC against test graph (port 14000).
# Prereqs: test HASH graph on :14000/:14001, docker for postgres.

cd "$(dirname "$0")"

BG_PID=0
cleanup() {
  [ "$BG_PID" -ne 0 ] && kill -INT $BG_PID 2>/dev/null; wait $BG_PID 2>/dev/null || true
}
trap cleanup EXIT

stop_bg() {
  [ "$BG_PID" -ne 0 ] && kill -INT $BG_PID 2>/dev/null; sleep 1; wait $BG_PID 2>/dev/null || true
  BG_PID=0
}

PSQL="docker exec integrations-postgres-1 psql -U postgres -d demo -q -c"

docker compose down -v 2>/dev/null || true

echo "--- seed test graph ---"
eval "$(npx tsx src/e2e/seed-graph.ts --graph-url http://localhost:14000 --admin-url http://localhost:14001 2>&1 | grep '^export HASH_')"

echo "--- postgres ---"
docker compose up -d postgres
sleep 2

echo "--- batch: initial sync ---"
npx tsx src/main.ts integration-batch.json 2>&1

echo "--- batch: no-op re-sync ---"
npx tsx src/main.ts integration-batch.json 2>&1

echo "--- batch: make changes ---"
$PSQL "UPDATE users SET city = 'Munich' WHERE email = 'alice@acme.example.com';"
$PSQL "INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES ('dave@acme.example.com', 'Dave', 'Brown', 'Berlin', 1);"
$PSQL "DELETE FROM users WHERE email = 'carol@widgets.example.com';"

echo "--- batch: diff sync ---"
npx tsx src/main.ts integration-batch.json 2>&1

echo "--- batch: re-insert deleted user ---"
$PSQL "INSERT INTO users (id, email, first_name, last_name, city, organization_id) VALUES (3, 'carol@widgets.example.com', 'Carol', 'White', 'London', 2);"

echo "--- batch: revival sync ---"
npx tsx src/main.ts integration-batch.json 2>&1

echo ""
echo "--- re-seed test graph for CDC ---"
eval "$(npx tsx src/e2e/seed-graph.ts --graph-url http://localhost:14000 --admin-url http://localhost:14001 2>&1 | grep '^export HASH_')"
docker compose down -v 2>/dev/null || true
docker compose up -d postgres
sleep 2

echo "--- cdc ---"
npx tsx src/main.ts integration.json > /tmp/pg-cdc.log 2>&1 &
BG_PID=$!; sleep 2

$PSQL "INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES ('eve@example.com', 'Eve', 'Green', 'Berlin', 2);"
sleep 0.5
$PSQL "UPDATE users SET organization_id = 1, updated_at = now() WHERE email = 'eve@example.com';"
sleep 0.5
$PSQL "DELETE FROM users WHERE email = 'eve@example.com';"
sleep 0.5

stop_bg
cat /tmp/pg-cdc.log

echo ""
echo "--- graph ---"
npx tsx src/e2e/view-graph.ts

echo "--- done ---"
