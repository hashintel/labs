# Demo

## Setup

```bash
# Start demo postgres (port 5433)
docker compose up -d postgres

# Discover live graph config (alice's web + types)
eval "$(npx tsx src/e2e/discover-graph.ts --web alice 2>&1 | grep '^export HASH_')"

# Run (CDC — streams WAL changes)
npx tsx src/main.ts

# Or watermark polling
npx tsx src/main.ts integration-watermark.json
```

## DB changes (separate terminal)

```bash
# Insert user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES ('eve@example.com', 'Eve', 'Green', 'Berlin', 2);"

# Update user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "UPDATE users SET city = 'Munich', updated_at = now() WHERE email = 'eve@example.com';"

# New org
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "INSERT INTO organizations (name) VALUES ('New Startup');"

# Delete user
docker exec integrations-postgres-1 psql -U postgres -d demo -c \
  "DELETE FROM users WHERE email = 'eve@example.com';"
```

## View graph

```bash
eval "$(npx tsx src/e2e/discover-graph.ts --web alice 2>&1 | grep '^export HASH_')"
npx tsx src/e2e/view-graph.ts
```
