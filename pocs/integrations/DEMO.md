# Demo

## Prereqs

- HASH graph on `localhost:4000`
- Docker for demo Postgres on port 5433

```bash
docker compose up -d postgres
eval "$(npx tsx src/e2e/discover-graph.ts --web alice 2>&1 | grep '^export HASH_')"
```

## 1. CDC streaming

```bash
npx tsx src/main.ts --setup-types

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

## 2. Batch sync


```bash
npx tsx src/main.ts integration-batch.json

# update a user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "UPDATE users SET city = 'Munich' WHERE email = 'alice@acme.example.com';"

# add a user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES ('dave@acme.example.com', 'Dave', 'Brown', 'Berlin', 1);"

# delete a user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "DELETE FROM users WHERE email = 'carol@widgets.example.com';"

# re-sync
npx tsx src/main.ts integration-batch.json
```

Re-insert deleted, unarchives
```bash
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO users (id, email, first_name, last_name, city, organization_id) VALUES (3, 'carol@widgets.example.com', 'Carol', 'White', 'London', 2);"

npx tsx src/main.ts integration-batch.json
```

## 3. Aviation (REST API)

```bash
npx tsx src/main.ts integration-aviation.json


```bash
npx tsx src/e2e/setup-types.ts integration-batch.json
```
