import sql from "sql-template-tag";
import {
  pipe,
  sqlStep,
  graphSinkStep,
  namespace,
  type Pipeline,
  type SchemaDecl,
  type TablePipeline,
} from "./transform/pipeline.js";

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

function orgSink(source: string | Pipeline, env: PipelineEnv): Pipeline {
  const T = namespace(env.typeBase);
  return pipe(
    source,
    graphSinkStep({
      id: "write-orgs",
      entityType: T.entity("organization/v/1"),
      entityId: "orgId",
      webId: env.webId,
      properties: {
        [`${env.typeBase}/property-type/organization-name/v/1`]: "orgName",
      },
      provenance: { location: { name: "crm-connector" } },
    }),
  );
}

function postgresOrgPipeline(env: PipelineEnv): Pipeline {
  return orgSink(
    pipe(
      "crm/organizations",
      sqlStep({
        id: "org-normalize",
        query: sql`SELECT _op, _key, _before, COALESCE(id, _key->>'id') AS orgId, name AS orgName FROM input`,
      }),
    ),
    env,
  );
}

function userSink(source: string | Pipeline, env: PipelineEnv): Pipeline {
  const T = namespace(env.typeBase);
  return pipe(
    source,
    sqlStep({
      id: "enrich",
      query: sql`SELECT _op, _key, _before, userId, LOWER(TRIM(email)) AS email, TRIM(displayName) AS displayName, city, orgId FROM input`,
    }),
    graphSinkStep({
      id: "write-users",
      entityType: T.entity("user/v/1"),
      entityId: "userId",
      webId: env.webId,
      properties: {
        "https://hash.ai/@h/types/property-type/email/v/1": "email",
        "https://blockprotocol.org/@blockprotocol/types/property-type/display-name/v/1":
          "displayName",
        "https://hash.ai/@h/types/property-type/city/v/1": "city",
      },
      links: [
        {
          column: "orgId",
          sourceColumn: "organization_id",
          linkType: T.link("is-member-of/v/1"),
          targetEntityType: T.entity("organization/v/1"),
        },
      ],
      provenance: { location: { name: "crm-connector" } },
    }),
  );
}

function postgresUserPipeline(env: PipelineEnv): Pipeline {
  return userSink(
    pipe(
      "crm/users",
      sqlStep({
        id: "pg-clean",
        query: sql`SELECT *, trim(first_name || ' ' || last_name) AS full_name FROM input`,
      }),
      sqlStep({
        id: "normalize",
        query: sql`SELECT _op, _key, _before, COALESCE(id, _key->>'id') AS userId, email, full_name AS displayName, COALESCE(city, 'unknown') AS city, organization_id AS orgId FROM input`,
        output: NormalizedUser,
      }),
    ),
    env,
  );
}

function mongoUserPipeline(env: PipelineEnv): Pipeline {
  return userSink(
    pipe(
      "crm/users",
      sqlStep({
        id: "mongo-flatten",
        query: sql`SELECT *, address->>'city' AS city FROM input`,
      }),
      sqlStep({
        id: "normalize",
        query: sql`SELECT _op, _key, _before, _id AS userId, email, name AS displayName, city, organizationId AS orgId FROM input`,
        output: NormalizedUser,
      }),
    ),
    env,
  );
}

export function postgresPipelines(env: PipelineEnv): TablePipeline[] {
  return [
    { table: "organizations", pipeline: postgresOrgPipeline(env) },
    { table: "users", pipeline: postgresUserPipeline(env), dependsOn: ["organizations"] },
  ];
}

export function mongoPipelines(env: PipelineEnv): TablePipeline[] {
  return [{ table: "users", pipeline: mongoUserPipeline(env) }];
}
