# Demo

Streams Postgres CDC changes to the HASH entity graph in real-time.

## Prerequisites

- HASH graph running on `localhost:4000` (with types created for your web)
- Docker (for the demo Postgres on port 5433)

## Run

```bash
docker compose up -d postgres
eval "$(npx tsx src/e2e/discover-graph.ts --web alice 2>&1 | grep '^export HASH_')"
npx tsx src/main.ts
```

CDC mode is the default. For watermark polling instead:
```bash
npx tsx src/main.ts integration-watermark.json
```

## Make changes (separate terminal)

```bash
# Insert
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES ('eve@example.com', 'Eve', 'Green', 'Berlin', 2);"

# Update
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "UPDATE users SET city = 'Munich', updated_at = now() WHERE email = 'eve@example.com';"

# New org
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO organizations (name) VALUES ('New Startup');"

# Delete
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "DELETE FROM users WHERE email = 'eve@example.com';"
```

## Inspect the graph

```bash
eval "$(npx tsx src/e2e/discover-graph.ts --web <your-shortname> 2>&1 | grep '^export HASH_')"
npx tsx src/e2e/view-graph.ts
```

## Graph type setup

The demo needs these entity types in your web:
- **Organization** with `organization-name` (text)
- **User** with `email` (text), `display-name` (text), `city` (text)
- **Is Member Of** link type (on User, targeting Organization)

Create them in the HASH UI, then `discover-graph.ts --web <shortname>` picks them up automatically.
