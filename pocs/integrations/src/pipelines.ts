import { Schema } from "effect";
import sql from "sql-template-tag";
import { pipe, sqlStep, lambdaStep, type Pipeline } from "./transform/types.js";

export const NormalizedUser = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  displayName: Schema.String,
  city: Schema.String,
  orgId: Schema.String,
});
export type NormalizedUser = typeof NormalizedUser.Type;

function businessLogic(source: string | Pipeline): Pipeline {
  return pipe(source,
    lambdaStep<NormalizedUser, NormalizedUser>({
      id: "enrich",
      transform: (rows) => rows.map((r) => ({
        ...r,
        email: r.email.toLowerCase().trim(),
        displayName: r.displayName.trim(),
      })),
      input: NormalizedUser,
    }),
    sqlStep({
      id: "graph-shape",
      query: sql`SELECT _op, _key, userId AS "primaryKey", email, displayName, city, orgId, 'integration' AS source FROM input`,
    }),
  );
}

export const postgresPipeline = businessLogic(
  pipe("crm/users",
    sqlStep({ id: "pg-clean", query: sql`SELECT *, trim(first_name || ' ' || last_name) AS full_name FROM input` }),
    sqlStep({ id: "normalize", query: sql`SELECT _op, _key, id AS userId, email, full_name AS displayName, 'unknown' AS city, organization_id AS orgId FROM input`, output: NormalizedUser }),
  ),
);

export const mongoPipeline = businessLogic(
  pipe("crm/users",
    sqlStep({ id: "mongo-flatten", query: sql`SELECT *, address->>'city' AS city FROM input` }),
    sqlStep({ id: "normalize", query: sql`SELECT _op, _key, _id AS userId, email, name AS displayName, city, organizationId AS orgId FROM input`, output: NormalizedUser }),
  ),
);
