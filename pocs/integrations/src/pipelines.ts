import sql from "sql-template-tag";
import { pipe, sqlStep, type Pipeline, type SchemaDecl } from "./transform/pipeline.js";

export const NormalizedUser: SchemaDecl = {
  userId: "string",
  email: "string",
  displayName: "string",
  city: "string",
  orgId: "string",
};

function businessLogic(source: string | Pipeline): Pipeline {
  return pipe(source,
    sqlStep({
      id: "enrich",
      query: sql`SELECT _op, _key, userId, LOWER(TRIM(email)) AS email, TRIM(displayName) AS displayName, city, orgId FROM input`,
    }),
    sqlStep({
      id: "graph-shape",
      query: sql`SELECT _op, _key, userId AS "primaryKey", email, displayName, city, orgId, 'integration' AS source FROM input`,
    }),
  );
}

export const postgresPipeline: Pipeline = businessLogic(
  pipe("crm/users",
    sqlStep({ id: "pg-clean", query: sql`SELECT *, trim(first_name || ' ' || last_name) AS full_name FROM input` }),
    sqlStep({ id: "normalize", query: sql`SELECT _op, _key, id AS userId, email, full_name AS displayName, 'unknown' AS city, organization_id AS orgId FROM input`, output: NormalizedUser }),
  ),
);

export const mongoPipeline: Pipeline = businessLogic(
  pipe("crm/users",
    sqlStep({ id: "mongo-flatten", query: sql`SELECT *, address->>'city' AS city FROM input` }),
    sqlStep({ id: "normalize", query: sql`SELECT _op, _key, _id AS userId, email, name AS displayName, city, organizationId AS orgId FROM input`, output: NormalizedUser }),
  ),
);
