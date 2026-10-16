import { describe, expect, it } from "vitest";

import { Refusal } from "../diagnostics";
import { binary, bool, ite, not, num, ref, relu, scale } from "../graph/linear-graph";
import {
  array,
  lambdaOf,
  lit,
  local,
  op,
  text,
  token,
  tokenAttribute,
} from "../testing/code-builders";
import { parseCode } from "../testing/fixture-parser";
import { type LinearCodeEnv, translateGuard, translateRate } from "./linear-code";

import type { DiagnosticCode } from "../diagnostics";
import type { CodeExpr, CodeFunction } from "./code-tree";

/** The tree of a guard or rate, read by the fixture parser. */
function lambda(code: string): CodeFunction {
  return parseCode(code, "lambda");
}

/** One bound token of place Hangar: a Real battery, and a state and a mode with values of their own. */
const env: LinearCodeEnv = {
  inputName: "input",
  token: (place, index) =>
    place === "Hangar" && index === 0
      ? {
          attribute: (name) =>
            name === "battery"
              ? { expr: ref("Hangar_0_battery"), sort: "number" }
              : name === "state"
                ? {
                    expr: ref("Hangar_0_state"),
                    sort: "string",
                    codes: ["idle", "flying"],
                  }
                : name === "mode"
                  ? { expr: ref("Hangar_0_mode"), sort: "string", codes: ["off", "on"] }
                  : undefined,
        }
      : undefined,
  tokenCount: (place) => (place === "Hangar" ? 1 : undefined),
  sample: (kind, args) =>
    kind === "gaussian" && args[1]?.expr.kind === "num"
      ? binary("+", args[0]?.expr ?? num(0), scale(args[1].expr.value, ref("z_0")))
      : undefined,
};

/** The code a rate is refused with, or "accepted". */
function refusalOf(body: CodeExpr): string {
  try {
    translateRate(lambdaOf(body), env);
  } catch (error) {
    if (error instanceof Refusal) {
      return error.code;
    }
    throw error;
  }
  return "accepted";
}

describe("the linear translation of a code tree", () => {
  it("folds scaling by constants and division by a constant into one factor", () => {
    // GIVEN a rate scaled by a constant and divided by one, and a negated rate plus a constant
    const scaled = lambda("return 0.5 * (input.Hangar[0].battery / 4);");
    const negated = lambda("return -input.Hangar[0].battery + 2;");
    // WHEN each is translated
    const scaledExpr = translateRate(scaled, env);
    const negatedExpr = translateRate(negated, env);
    // THEN the constants fold into one factor
    expect(scaledExpr).toEqual(scale(0.125, ref("Hangar_0_battery")));
    expect(negatedExpr).toEqual(binary("+", scale(-1, ref("Hangar_0_battery")), num(2)));
  });

  it("folds arithmetic on two constants, so a constant factor still scales", () => {
    // GIVEN the unfolded trees of (1 + 1) * battery and battery / (6 - 2), as a parser that does not fold gives them
    const doubled = lambdaOf(
      op(op(lit(1), "+", lit(1)), "*", tokenAttribute("Hangar", 0, "battery")),
    );
    const quartered = lambdaOf(
      op(tokenAttribute("Hangar", 0, "battery"), "/", op(lit(6), "-", lit(2))),
    );
    // WHEN each is translated
    const doubledExpr = translateRate(doubled, env);
    const quarteredExpr = translateRate(quartered, env);
    // THEN each is the attribute scaled by one constant, not a refused product or division
    expect(doubledExpr).toEqual(scale(2, ref("Hangar_0_battery")));
    expect(quarteredExpr).toEqual(scale(0.25, ref("Hangar_0_battery")));
  });

  it("writes max, min and abs with relu", () => {
    // GIVEN a rate through Math.max and one through Math.abs
    const max = lambda("return Math.max(input.Hangar[0].battery, 50);");
    const abs = lambda("return Math.abs(input.Hangar[0].battery);");
    // WHEN each is translated
    const maxExpr = translateRate(max, env);
    const absExpr = translateRate(abs, env);
    // THEN each is written with relu
    expect(maxExpr).toEqual(
      binary("+", ref("Hangar_0_battery"), relu(binary("-", num(50), ref("Hangar_0_battery")))),
    );
    expect(absExpr).toEqual(
      binary("+", relu(ref("Hangar_0_battery")), relu(scale(-1, ref("Hangar_0_battery")))),
    );
  });

  it("compares a string attribute with a literal by its code, and decides a value it never takes", () => {
    // GIVEN a guard testing a value the state takes, and one testing a value it never takes
    const flying = lambda('return input.Hangar[0].state === "flying";');
    const lost = lambda('return input.Hangar[0].state !== "lost";');
    // WHEN each is translated
    const flyingExpr = translateGuard(flying, env);
    const lostExpr = translateGuard(lost, env);
    // THEN the first compares codes and the second is decided
    expect(flyingExpr).toEqual(binary("==", ref("Hangar_0_state"), num(1)));
    expect(lostExpr).toEqual(bool(true));
  });

  it("keeps conditionals, logic, lengths and let bindings", () => {
    // GIVEN a guard with let bindings, logic and a length, and a rate with a conditional
    const guard = lambda(
      "const drone = input.Hangar[0];\nconst low = drone.battery < 20;\nreturn low || (!low && input.Hangar.length >= 1);",
    );
    const rate = lambda("return input.Hangar[0].battery > 50 ? 2 : 0.5;");
    // WHEN each is translated
    const guardExpr = translateGuard(guard, env);
    const rateExpr = translateRate(rate, env);
    // THEN the bindings are inlined, the length is the bound count, and the conditional stays
    expect(guardExpr).toEqual(
      binary(
        "|",
        binary("<", ref("Hangar_0_battery"), num(20)),
        binary(
          "&",
          not(binary("<", ref("Hangar_0_battery"), num(20))),
          binary(">=", num(1), num(1)),
        ),
      ),
    );
    expect(rateExpr).toEqual(ite(binary(">", ref("Hangar_0_battery"), num(50)), num(2), num(0.5)));
  });

  it("draws a Gaussian with a constant spread as mean plus spread times an input", () => {
    // GIVEN a rate that maps a Gaussian draw with a constant spread
    const rate = lambda(
      "return Distribution.Gaussian(input.Hangar[0].battery, 4).map((v) => v + 1);",
    );
    // WHEN it is translated
    const expr = translateRate(rate, env);
    // THEN the draw is the mean plus the spread times a standard input
    expect(expr).toEqual(
      binary("+", binary("+", ref("Hangar_0_battery"), scale(4, ref("z_0"))), num(1)),
    );
  });

  const battery = tokenAttribute("Hangar", 0, "battery");

  it.each<[DiagnosticCode, CodeExpr]>([
    ["nonlinear-product", op(battery, "*", battery)],
    ["nonlinear-division", op(lit(1), "/", battery)],
    ["nonlinear-power", op(battery, "**", lit(2))],
    ["nonlinear-math", { kind: "mathCall", fn: "exp", args: [battery] }],
    ["math-random", { kind: "mathCall", fn: "random", args: [] }],
    ["non-finite-constant", { kind: "constant", name: "Infinity" }],
    [
      "distribution-unsupported",
      { kind: "distribution", dist: "gaussian", args: [lit(1), battery] },
    ],
    ["sort-mismatch", op(battery, "+", { kind: "boolLit", value: true })],
    ["string-as-value", text("idle")],
    [
      "string-codes-differ",
      op(tokenAttribute("Hangar", 0, "state"), "==", tokenAttribute("Hangar", 0, "mode")),
    ],
    ["token-as-value", token("Hangar", 0)],
    ["unbound-local", local("level")],
    ["unknown-field", { kind: "fieldAccess", target: lit(1), field: "battery" }],
    ["unknown-attribute", tokenAttribute("Hangar", 0, "altitude")],
    ["unknown-length", { kind: "length", target: local("input") }],
    ["array-in-expression", array(battery)],
  ])("refuses with %s what the theories cannot hold", (code, body) => {
    // GIVEN a rate outside the linear theories
    // WHEN it is translated
    const refused = refusalOf(body);
    // THEN it is refused with its own code
    expect(refused).toBe(code);
  });
});
