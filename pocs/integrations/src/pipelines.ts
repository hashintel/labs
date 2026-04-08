import sql from "sql-template-tag";
import { pipe, sqlStep, graphSinkStep, namespace, type Pipeline, type SchemaDecl } from "./transform/pipeline.js";

export type PipelineEnv = {
  typeBase: string;
  webId: string;
};

export const NormalizedUser: SchemaDecl = {
  userId: "string",
  email: "string",
  displayName: "string",
  city: "string",
  orgId: "string",
};

function withGraphSink(source: string | Pipeline, env: PipelineEnv): Pipeline {
  const T = namespace(env.typeBase);
  return pipe(source,
    sqlStep({
      id: "enrich",
      query: sql`SELECT _op, _key, userId, LOWER(TRIM(email)) AS email, TRIM(displayName) AS displayName, city, orgId FROM input`,
    }),
    graphSinkStep({
      id: "write-users",
      entityType: T.entity("user/v/1"),
      entityId: "userId",
      webId: env.webId,
      properties: {
        [T.property("email/v/1")]: "email",
        [T.property("display-name/v/1")]: "displayName",
        [T.property("city/v/1")]: "city",
      },
      links: [{
        column: "orgId",
        linkType: T.link("member-of/v/1"),
        targetEntityType: T.entity("organization/v/1"),
      }],
      provenance: { location: { name: "crm-connector" } },
    }),
  );
}

export function postgresPipeline(env: PipelineEnv): Pipeline {
  return withGraphSink(
    pipe("crm/users",
      sqlStep({ id: "pg-clean", query: sql`SELECT *, trim(first_name || ' ' || last_name) AS full_name FROM input` }),
      sqlStep({ id: "normalize", query: sql`SELECT _op, _key, COALESCE(id, _key->>'id') AS userId, email, full_name AS displayName, COALESCE(city, 'unknown') AS city, organization_id AS orgId FROM input`, output: NormalizedUser }),
    ),
    env,
  );
}

export function mongoPipeline(env: PipelineEnv): Pipeline {
  return withGraphSink(
    pipe("crm/users",
      sqlStep({ id: "mongo-flatten", query: sql`SELECT *, address->>'city' AS city FROM input` }),
      sqlStep({ id: "normalize", query: sql`SELECT _op, _key, _id AS userId, email, name AS displayName, city, organizationId AS orgId FROM input`, output: NormalizedUser }),
    ),
    env,
  );
}
