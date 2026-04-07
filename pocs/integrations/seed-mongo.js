db = db.getSiblingDB("demo");

db.users.insertMany([
  {
    name: "Alice",
    email: "alice@acme.example.com",
    address: { city: "New York", zip: "10001" },
    tags: ["admin", "user"],
    organizationId: "acme",
    updatedAt: new Date(),
  },
  {
    name: "Bob",
    email: "bob@acme.example.com",
    address: { city: "London", zip: "EC1A" },
    tags: ["user"],
    organizationId: "acme",
    updatedAt: new Date(),
  },
  {
    name: "Carol",
    email: "carol@widgets.example.com",
    address: { city: "Berlin", zip: "10115" },
    tags: ["user"],
    organizationId: "widgets",
    updatedAt: new Date(),
  },
]);
