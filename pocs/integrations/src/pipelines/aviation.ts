import sql from "sql-template-tag";
import {
  pipe,
  sqlStep,
  graphSinkStep,
  branch,
  namespace,
} from "../transform/pipeline.js";
import type { TablePipeline } from "../engine.js";

const H = namespace("https://hash.ai/@h/types");
const BP = namespace("https://blockprotocol.org/@blockprotocol/types");

export type AviationEnv = {
  webId: string;
};

export function aviationPipelines(env: AviationEnv): TablePipeline[] {
  return [
    {
      table: "arrivals",
      pipeline: pipe(
        "flightaware/arrivals",
        sqlStep({
          id: "cleanup",
          query: sql`SELECT _op, _key, _before, * EXCLUDE (_op, _key, _before) FROM input WHERE ident_iata IS NOT NULL AND fa_flight_id IS NOT NULL`,
        }),
        branch("extract",
          [
            sqlStep({
              id: "norm-airports",
              query: sql`
                SELECT DISTINCT ON (icaoCode)
                  _op, _key, _before, icaoCode, name, iataCode, timezone, city
                FROM (
                  SELECT _op, _key, _before,
                    origin->>'code_icao' AS icaoCode,
                    origin->>'name' AS name,
                    origin->>'code_iata' AS iataCode,
                    origin->>'timezone' AS timezone,
                    origin->>'city' AS city
                  FROM input WHERE origin->>'code_icao' IS NOT NULL
                  UNION ALL
                  SELECT _op, _key, _before,
                    destination->>'code_icao' AS icaoCode,
                    destination->>'name' AS name,
                    destination->>'code_iata' AS iataCode,
                    destination->>'timezone' AS timezone,
                    destination->>'city' AS city
                  FROM input WHERE destination->>'code_icao' IS NOT NULL
                ) airports
              `,
            }),
            graphSinkStep({
              id: "write-airports",
              entityType: H.entity("airport/v/1"),
              entityId: "icaoCode",
              webId: env.webId,
              properties: {
                [BP.property("name/v/1")]: "name",
                [H.property("icao-code/v/1")]: "icaoCode",
                [H.property("iata-code/v/1")]: "iataCode",
                [H.property("timezone/v/1")]: "timezone",
                [H.property("city/v/1")]: "city",
              },
              provenance: { location: { name: "FlightAware AeroAPI", uri: "https://aeroapi.flightaware.com/aeroapi/" } },
            }),
          ],
          [
            sqlStep({
              id: "norm-airlines",
              query: sql`
                SELECT DISTINCT ON (icaoCode) _op, _key, _before, icaoCode, iataCode, name
                FROM (
                  SELECT _op, _key, _before,
                    operator_icao AS icaoCode,
                    operator_iata AS iataCode,
                    COALESCE(operator, operator_icao, operator_iata) AS name
                  FROM input WHERE operator_icao IS NOT NULL
                ) airlines
              `,
            }),
            graphSinkStep({
              id: "write-airlines",
              entityType: H.entity("airline/v/1"),
              entityId: "icaoCode",
              webId: env.webId,
              properties: {
                [BP.property("name/v/1")]: "name",
                [H.property("icao-code/v/1")]: "icaoCode",
                [H.property("iata-code/v/1")]: "iataCode",
              },
              provenance: { location: { name: "FlightAware AeroAPI", uri: "https://aeroapi.flightaware.com/aeroapi/" } },
            }),
          ],
          [
            sqlStep({
              id: "norm-flights",
              query: sql`
                SELECT
                  _op, _key, _before,
                  fa_flight_id AS flightId,
                  ident_iata AS flightNumber,
                  ident_icao AS icaoCode,
                  ident_iata AS iataCode,
                  type AS flightType,
                  CASE
                    WHEN cancelled THEN 'Cancelled'
                    WHEN diverted THEN 'Diverted'
                    WHEN actual_on IS NOT NULL THEN 'Landed'
                    WHEN actual_off IS NOT NULL OR actual_out IS NOT NULL THEN 'Active'
                    ELSE 'Scheduled'
                  END AS flightStatus,
                  COALESCE(
                    scheduled_out, scheduled_off,
                    actual_out, actual_off, scheduled_in, scheduled_on
                  )::DATE::VARCHAR AS flightDate,
                  origin->>'code_icao' AS originIcao,
                  destination->>'code_icao' AS destIcao,
                  operator_icao AS airlineIcao,
                  gate_origin AS departGate,
                  terminal_origin AS departTerminal,
                  actual_runway_off AS departRunway,
                  departure_delay AS departDelay,
                  scheduled_out AS departSchedGate,
                  actual_out AS departActGate,
                  scheduled_off AS departSchedRunway,
                  actual_off AS departActRunway,
                  gate_destination AS arriveGate,
                  terminal_destination AS arriveTerminal,
                  actual_runway_on AS arriveRunway,
                  baggage_claim AS arriveBaggage,
                  arrival_delay AS arriveDelay,
                  scheduled_in AS arriveSchedGate,
                  actual_in AS arriveActGate,
                  scheduled_on AS arriveSchedRunway,
                  actual_on AS arriveActRunway
                FROM input
              `,
            }),
            graphSinkStep({
              id: "write-flights",
              entityType: H.entity("flight/v/1"),
              entityId: "flightId",
              webId: env.webId,
              properties: {
                [H.property("flight-number/v/1")]: "flightNumber",
                [H.property("icao-code/v/1")]: "icaoCode",
                [H.property("iata-code/v/1")]: "iataCode",
                [H.property("flight-type/v/1")]: "flightType",
                [H.property("flight-status/v/1")]: "flightStatus",
                [H.property("flight-date/v/1")]: "flightDate",
              },
              links: [
                {
                  column: "originIcao",
                  linkType: H.entity("departs-from/v/1"),
                  targetEntityType: H.entity("airport/v/1"),
                  properties: {
                    [H.property("gate/v/1")]: "departGate",
                    [H.property("terminal/v/1")]: "departTerminal",
                    [H.property("runway/v/1")]: "departRunway",
                    [H.property("delay-in-seconds/v/1")]: (r) => r.departDelay != null ? Number(r.departDelay) : null,
                    [H.property("scheduled-gate-time/v/1")]: "departSchedGate",
                    [H.property("actual-gate-time/v/1")]: "departActGate",
                    [H.property("scheduled-runway-time/v/1")]: "departSchedRunway",
                    [H.property("actual-runway-time/v/1")]: "departActRunway",
                  },
                },
                {
                  column: "destIcao",
                  linkType: H.entity("arrives-at/v/1"),
                  targetEntityType: H.entity("airport/v/1"),
                  properties: {
                    [H.property("gate/v/1")]: "arriveGate",
                    [H.property("terminal/v/1")]: "arriveTerminal",
                    [H.property("runway/v/1")]: "arriveRunway",
                    [H.property("baggage-claim/v/1")]: "arriveBaggage",
                    [H.property("delay-in-seconds/v/1")]: (r) => r.arriveDelay != null ? Number(r.arriveDelay) : null,
                    [H.property("scheduled-gate-time/v/1")]: "arriveSchedGate",
                    [H.property("actual-gate-time/v/1")]: "arriveActGate",
                    [H.property("scheduled-runway-time/v/1")]: "arriveSchedRunway",
                    [H.property("actual-runway-time/v/1")]: "arriveActRunway",
                  },
                },
                {
                  column: "airlineIcao",
                  linkType: H.entity("operated-by/v/1"),
                  targetEntityType: H.entity("airline/v/1"),
                },
              ],
              provenance: { location: { name: "FlightAware AeroAPI", uri: "https://aeroapi.flightaware.com/aeroapi/" } },
            }),
          ],
        ),
      ),
    },
  ];
}
