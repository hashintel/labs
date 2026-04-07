#!/usr/bin/env bash
set -euo pipefail

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

docker compose down -v 2>/dev/null || true

echo "--- postgres: start ---"
docker compose up -d postgres
sleep 2

echo "--- postgres: watermark snapshot ---"
npx tsx src/demo.ts integration-watermark.json > /tmp/pg-watermark.log 2>&1 &
BG_PID=$!
sleep 3
stop_bg
echo "--- postgres: watermark output ---"
cat /tmp/pg-watermark.log

echo "--- postgres: cdc ---"
npx tsx src/demo.ts integration.json > /tmp/pg-cdc.log 2>&1 &
BG_PID=$!
sleep 2

docker exec integrations-postgres-1 psql -U postgres -d demo -q -c \
  "INSERT INTO users (email, first_name, last_name, organization_id) VALUES ('eve@example.com', 'Eve', 'Green', 2);"
sleep 0.5

docker exec integrations-postgres-1 psql -U postgres -d demo -q -c \
  "UPDATE users SET email = 'eve.updated@example.com', updated_at = now() WHERE email = 'eve@example.com';"
sleep 0.5

docker exec integrations-postgres-1 psql -U postgres -d demo -q -c \
  "DELETE FROM users WHERE email = 'eve.updated@example.com';"
sleep 0.5

stop_bg
echo "--- postgres: cdc output ---"
cat /tmp/pg-cdc.log

echo ""
echo "--- mongo: start ---"
docker compose up -d mongo
sleep 3

docker exec integrations-mongo-1 mongosh --quiet --eval \
  "try { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }); } catch(e) {}" 2>/dev/null || true

until docker exec integrations-mongo-1 mongosh --quiet --eval "rs.isMaster().ismaster" 2>/dev/null | grep -q true; do sleep 0.5; done

docker exec -i integrations-mongo-1 mongosh --quiet demo < seed-mongo.js

echo "--- mongo: watermark snapshot ---"
npx tsx src/demo.ts integration-mongo.json > /tmp/mongo-watermark.log 2>&1 &
BG_PID=$!
sleep 3
stop_bg
echo "--- mongo: watermark output ---"
cat /tmp/mongo-watermark.log

echo ""
echo "--- done ---"
