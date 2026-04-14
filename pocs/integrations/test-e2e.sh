#!/usr/bin/env bash
set -euo pipefail
# Automated e2e: seeds a TEST graph (port 14000), runs watermark+CDC+mongo against it.
# Prereqs: test HASH graph on :14000/:14001, docker for postgres/mongo.

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

docker compose down -v 2>/dev/null || true

echo "--- seed test graph ---"
eval "$(npx tsx src/e2e/seed-graph.ts --graph-url http://localhost:14000 --admin-url http://localhost:14001 2>&1 | grep '^export HASH_')"

echo "--- postgres ---"
docker compose up -d postgres
sleep 2

echo "--- watermark ---"
npx tsx src/main.ts integration-watermark.json > /tmp/pg-watermark.log 2>&1 &
BG_PID=$!; sleep 3; stop_bg
cat /tmp/pg-watermark.log

echo "--- cdc ---"
npx tsx src/main.ts integration.json > /tmp/pg-cdc.log 2>&1 &
BG_PID=$!; sleep 2

docker exec integrations-postgres-1 psql -U postgres -d demo -q -c \
  "INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES ('eve@example.com', 'Eve', 'Green', 'Berlin', 2);"
sleep 0.5
docker exec integrations-postgres-1 psql -U postgres -d demo -q -c \
  "UPDATE users SET email = 'eve.updated@example.com', updated_at = now() WHERE email = 'eve@example.com';"
sleep 0.5
docker exec integrations-postgres-1 psql -U postgres -d demo -q -c \
  "DELETE FROM users WHERE email = 'eve.updated@example.com';"
sleep 0.5

stop_bg
cat /tmp/pg-cdc.log

echo ""
echo "--- re-seed test graph ---"
eval "$(npx tsx src/e2e/seed-graph.ts --graph-url http://localhost:14000 --admin-url http://localhost:14001 2>&1 | grep '^export HASH_')"

echo "--- mongo ---"
docker compose up -d mongo
sleep 3
docker exec integrations-mongo-1 mongosh --quiet --eval \
  "try { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }); } catch(e) {}" 2>/dev/null || true
until docker exec integrations-mongo-1 mongosh --quiet --eval "rs.isMaster().ismaster" 2>/dev/null | grep -q true; do sleep 0.5; done
docker exec -i integrations-mongo-1 mongosh --quiet demo < seed-mongo.js

npx tsx src/main.ts integration-mongo.json > /tmp/mongo-watermark.log 2>&1 &
BG_PID=$!; sleep 3; stop_bg
cat /tmp/mongo-watermark.log

echo ""
echo "--- graph ---"
npx tsx src/e2e/view-graph.ts

echo "--- done ---"
