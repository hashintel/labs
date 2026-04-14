# Demo

Two modes for syncing Postgres to the HASH entity graph.

## Prerequisites

- HASH graph on `localhost:4000` with entity types created (see bottom)
- Docker for demo Postgres on port 5433

```bash
docker compose up -d postgres
eval "$(npx tsx src/e2e/discover-graph.ts --web <your-shortname> 2>&1 | grep '^export HASH_')"
```

---

## 1. Batch sync

Full snapshot, diffs against previous run, writes only changes.

```bash
npx tsx src/main.ts integration-batch.json
```

Run it again -- nothing happens (all entities unchanged):
```bash
npx tsx src/main.ts integration-batch.json
```

Now change some data and re-sync:
```bash
# update a user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "UPDATE users SET city = 'Munich' WHERE email = 'alice@acme.example.com';"

# add a user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES ('dave@acme.example.com', 'Dave', 'Brown', 'Berlin', 1);"

# delete a user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "DELETE FROM users WHERE email = 'carol@widgets.example.com';"

# re-sync -- only the 3 changes hit the graph
npx tsx src/main.ts integration-batch.json
```

Re-insert the deleted user -- entity revives (un-archives):
```bash
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO users (id, email, first_name, last_name, city, organization_id) VALUES (3, 'carol@widgets.example.com', 'Carol', 'White', 'London', 2);"

npx tsx src/main.ts integration-batch.json
```

---

## 2. CDC streaming

Streams WAL changes in real-time. Restart Postgres to get a fresh replication slot:

```bash
docker compose down -v && docker compose up -d postgres && sleep 2
npx tsx src/main.ts
```

In another terminal:
```bash
# insert
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES ('eve@example.com', 'Eve', 'Green', 'Berlin', 2);"

# update
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "UPDATE users SET city = 'Munich', updated_at = now() WHERE email = 'eve@example.com';"

# change org (old link archived, new link created)
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "UPDATE users SET organization_id = 1, updated_at = now() WHERE email = 'eve@example.com';"

# delete
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "DELETE FROM users WHERE email = 'eve@example.com';"
```

---

## Inspect

```bash
eval "$(npx tsx src/e2e/discover-graph.ts --web <your-shortname> 2>&1 | grep '^export HASH_')"
npx tsx src/e2e/view-graph.ts
```

---

## Graph type setup

Create these in the HASH UI under your web:

- **Organization** with property: `organization-name` (text)
- **User** with properties: `email` (text), `display-name` (text), `city` (text)
- **Is Member Of** link type on User, targeting Organization

Then `discover-graph.ts --web <shortname>` picks them up.

---

## 3. Aviation (REST API)

Syncs flight data from FlightAware AeroAPI. Creates flights, airports, airlines with links.

```bash
export AERO_API_KEY=your-key-here
eval "$(npx tsx src/e2e/discover-graph.ts --web <your-shortname> 2>&1 | grep '^export HASH_')"
npx tsx src/main.ts integration-aviation.json
```

Uses the branch step to extract 3 entity types from one API response:
- Flights with departs-from/arrives-at/operated-by links (including timing properties)
- Airports (deduplicated from origin/destination)
- Airlines (deduplicated from operator)

The aviation entity types (flight, airport, airline, departs-from, arrives-at, operated-by) are system types at `hash.ai/@h/types/`.
