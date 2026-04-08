CREATE TABLE organizations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    city TEXT,
    organization_id INTEGER REFERENCES organizations(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For full before-images on update/delete
ALTER TABLE users REPLICA IDENTITY FULL;
ALTER TABLE organizations REPLICA IDENTITY FULL;

-- Publication for CDC
CREATE PUBLICATION hash_cdc FOR TABLE users, organizations;

-- Replication slot
SELECT pg_create_logical_replication_slot('hash_slot', 'pgoutput');

-- Seed data
INSERT INTO organizations (name) VALUES ('Acme Corp'), ('Widgets Ltd');
INSERT INTO users (email, first_name, last_name, city, organization_id) VALUES
    ('alice@acme.example.com', 'Alice', 'Smith', 'NYC', 1),
    ('bob@acme.example.com', 'Bob', 'Jones', 'LA', 1),
    ('carol@widgets.example.com', 'Carol', 'White', 'London', 2);
