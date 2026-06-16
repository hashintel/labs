import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registry, measureAccessor } from "./coerce.js";
import { isTypedValue } from "@integrations/graph/types.js";

type Row = Record<string, unknown>;
const apply = (name: keyof typeof registry, col: string, v: unknown) => {
  const acc = registry[name](col);
  if (typeof acc !== "function") throw new Error(`coercion "${name}" is not a function accessor`);
  return acc({ [col]: v } as Row);
};
const date = (v: unknown) => apply("date", "D", v);
const time = (v: unknown) => apply("time", "T", v);
const num = (v: unknown) => apply("number", "N", v);

describe("coerce date", () => {
  it("parses SAP dotted dd.MM.yyyy (MKPF/LIKP/VBAK)", () => {
    assert.equal(date("01.02.2024"), "2024-02-01");
  });
  it("parses SAP slashed dd/MM/yyyy (EKET/VTTK extracts)", () => {
    assert.equal(date("01/02/2024"), "2024-02-01");
  });
  it("nulls the 00/00/0000 and 00.00.0000 sentinels", () => {
    assert.equal(date("00/00/0000"), null);
    assert.equal(date("00.00.0000"), null);
  });
  it("nulls blank and unparseable junk (e.g. scientific-notation artifacts)", () => {
    assert.equal(date(""), null);
    assert.equal(date("00029E+11"), null);
  });
  it("passes through ISO yyyy-MM-dd", () => {
    assert.equal(date("2024-02-01"), "2024-02-01");
  });
});

describe("coerce time", () => {
  it("appends UTC offset for RFC 3339 full-time", () => {
    assert.equal(time("16:32:03"), "16:32:03+00:00");
  });
  it("nulls the 000000 sentinel", () => {
    assert.equal(time("000000"), null);
  });
});

describe("coerce number", () => {
  it("parses German/EU format 1.234,56", () => {
    assert.equal(num("1.234,56"), 1234.56);
  });
  it("parses plain decimals", () => {
    assert.equal(num("141.532"), 141.532);
  });
});

describe("measureAccessor", () => {
  const each = "https://hash.ai/@h/types/data-type/each/v/1";
  const kg = "https://hash.ai/@h/types/data-type/kilograms/v/1";
  const unit = "https://hash.ai/@h/types/data-type/unit/v/1";
  const map = { EA: each, KG: kg, "*": unit };

  const call = (acc: ReturnType<typeof measureAccessor>, row: Row) => {
    if (typeof acc !== "function") throw new Error("measure accessor is not a function");
    return acc(row);
  };

  it("types the amount by the unit's data type", () => {
    const v = call(measureAccessor("qty", "uom", map), { qty: "12,5", uom: "KG" }) as any;
    assert.ok(isTypedValue(v));
    assert.equal(v.value, 12.5);
    assert.equal(v.dataTypeId, kg);
  });

  it("falls back to '*' for an unmapped unit", () => {
    const v = call(measureAccessor("qty", "uom", map), { qty: "3", uom: "ZZZ" }) as any;
    assert.ok(isTypedValue(v));
    assert.equal(v.dataTypeId, unit);
  });

  it("returns a plain number when unmapped and no fallback", () => {
    const v = call(measureAccessor("qty", "uom", { EA: each }), { qty: "3", uom: "ZZZ" });
    assert.equal(v, 3);
    assert.equal(isTypedValue(v), false);
  });

  it("returns null for a missing amount", () => {
    assert.equal(call(measureAccessor("qty", "uom", map), { qty: "", uom: "KG" }), null);
  });
});
