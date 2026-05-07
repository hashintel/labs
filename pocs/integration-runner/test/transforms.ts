import type { Row, Envelope } from "@integrations/transform/pipeline.js";

export function uppercase(rows: (Row & Envelope)[]): (Row & Envelope)[] {
  return rows.map((r) => ({
    ...r,
    name: typeof r.name === "string" ? r.name.toUpperCase() : r.name,
  }));
}
