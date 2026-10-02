import {
  assign,
  binary,
  bool,
  changedBy,
  changedWhen,
  comment,
  next,
  not,
  num,
  type LinearExpr,
  type LinearModule,
  type LinearGraph,
  type LinearStatement,
  type LinearVariable,
  ref,
  scale,
} from "../graph/linear-graph";
import { Refusal } from "../diagnostics";
import { lowerBindings } from "./monolithic/bindings";
import { countExpr, layoutInitialValues, layoutVariables } from "./colour-layout";
import { type Producer, lowerCompaction } from "./monolithic/compaction";
import { lowerDynamics } from "./monolithic/dynamics";
import { lowerKernel } from "./monolithic/kernels";
import {
  exponentialDrawName,
  fillName,
  fireName,
  kernelDrawName,
  netModuleNames,
  overflowName,
  presentName,
} from "./names";
import {
  drawModules,
  hitVariables,
  inputTerms,
  inputVariables,
  markingTheory,
} from "./guard-inputs";
import { arcTest, roomTest } from "./marking-terms";

import type { Diagnostic } from "../diagnostics";
import type { NetItem } from "../ir/net-item";
import type { LinearCodeEnv } from "../code/linear-code";
import type { Lowering } from "./lowering";
import type { PlannedTransition, StepPlan } from "./step-plan";

/**
 * The monolithic shape: one module drives every place, and its `next` is
 * one step of the net. Dynamics take their Euler step first; transitions are
 * swept in record order, a firing consumes its input tokens at once,
 * produced tokens land at the end of the step, and a capped place tracks
 * what it would hold if the step ended now so a later producer sees an
 * earlier one's tokens. A coloured place is a bounded set of slots whose
 * survivors close up before the produced tokens land.
 *
 * Under `marking: int` on a stochastic uncoloured net the draw tests move
 * into one LRA module per transition, and the step module reads their Bool
 * flags.
 */

const SWEEP_COMMENT = "sweep in order; a firing consumes its input tokens at once";
const LAND_COMMENT = "end of step: produced tokens land";
const FILL_COMMENT = "tokens a capped place would hold if the step ended now";
const DYNAMICS_COMMENT = "dynamics first: one Euler step on every present token";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function floatText(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

type StepBody = {
  body: LinearStatement[];
  returns: LinearExpr[];
  /** Draw inputs the kernels take, in allocation order. */
  drawVariables: LinearVariable[];
  /** Coloured places whose produced tokens can overflow their slots. */
  overflowing: string[];
};

/** The present flag of a slot, as the sweep has left it so far. */
function present(place: string, slot: number): LinearExpr {
  return ref(presentName(place, slot));
}

/** Draws a kernel takes: a standard normal per Gaussian, a uniform per Uniform with constant bounds. */
function createSampler(
  transition: PlannedTransition,
  drawVariables: LinearVariable[],
): LinearCodeEnv["sample"] {
  let normals = 0;
  let uniforms = 0;
  function drawInput(kind: "z" | "v", index: number, draw: string): LinearExpr {
    const name = kernelDrawName(transition.name, kind, index);
    drawVariables.push({
      name,
      sort: "real",
      role: "input",
      comment: `${draw} for ${transition.name}, each step`,
    });
    return next(name);
  }
  return (kind, args) => {
    const [first, second] = args;
    if (kind === "gaussian" && first?.sort === "number" && second?.expr.kind === "num") {
      return binary(
        "+",
        first.expr,
        scale(second.expr.value, drawInput("z", normals++, "standard normal draw")),
      );
    }
    if (kind === "uniform" && first?.expr.kind === "num" && second?.expr.kind === "num") {
      const low = first.expr.value;
      return binary(
        "+",
        num(low),
        scale(second.expr.value - low, drawInput("v", uniforms++, "uniform draw")),
      );
    }
    return undefined;
  };
}

/** Lowers one item's part of the step; a refusal becomes a diagnostic on the item. */
function attempt<T>(item: NetItem, errors: Diagnostic[], compute: () => T): T | undefined {
  try {
    return compute();
  } catch (error) {
    if (error instanceof Refusal) {
      errors.push({ code: error.code, message: error.message, item });
      return undefined;
    }
    throw error;
  }
}

/** 1. Dynamics, before anything fires: one Euler step per present token. */
function dynamicsStatements(plan: StepPlan, errors: Diagnostic[]): LinearStatement[] {
  const dynamic = plan.places.flatMap(({ name, layout, dynamics }) =>
    layout === null || dynamics === null ? [] : [{ name, layout, dynamics }],
  );
  return dynamic.length === 0
    ? []
    : [
        comment(DYNAMICS_COMMENT),
        ...dynamic.flatMap(
          ({ name, layout, dynamics }) =>
            attempt({ kind: "place", name }, errors, () =>
              lowerDynamics(layout, dynamics, plan.options.dt),
            ) ?? [],
        ),
      ];
}

/** 2. The tokens each capped place holds before the sweep, which every mover updates. */
function fillStatements(plan: StepPlan): LinearStatement[] {
  return plan.capped.size === 0
    ? []
    : [
        comment(FILL_COMMENT),
        ...[...plan.capped.keys()].map((place) => {
          const layout = plan.layouts.get(place);
          return assign(
            fillName(place),
            layout === undefined ? ref(place) : countExpr(layout, (slot) => present(place, slot)),
          );
        }),
      ];
}

function stepStatements(plan: StepPlan, errors: Diagnostic[]): StepBody {
  const drawVariables: LinearVariable[] = [];
  const body: LinearStatement[] = [
    ...dynamicsStatements(plan, errors),
    ...fillStatements(plan),
    comment(SWEEP_COMMENT),
  ];

  // 3. The sweep.
  const produced = new Map<string, { fire: string | null; weight: number }[]>(
    plan.places.map((place) => [place.name, []]),
  );
  const colouredProducers = new Map<string, Producer[]>(
    [...plan.layouts.keys()].map((place) => [place, []]),
  );
  for (const transition of plan.transitions) {
    const item = { kind: "transition" as const, name: transition.name };
    const shared: LinearExpr[] = [];
    for (const arc of transition.inputArcs) {
      const layout = plan.layouts.get(arc.place);
      if (layout === undefined) {
        shared.push(arcTest(arc, ref(arc.place)));
      } else if (arc.kind === "inhibitor") {
        shared.push(
          arcTest(
            arc,
            countExpr(layout, (slot) => present(arc.place, slot)),
          ),
        );
      }
    }
    for (const [place, capacity] of plan.capped) {
      const delta = transition.deltas.get(place) ?? 0;
      if (delta > 0) {
        shared.push(roomTest(ref(fillName(place)), delta, capacity));
      }
    }
    shared.push(...inputTerms(plan, transition).terms);
    const sample = createSampler(transition, drawVariables);

    const bindings = attempt(item, errors, () =>
      lowerBindings({
        plan,
        transition,
        sharedTerms: shared,
        present,
        sample,
      }),
    );
    if (bindings === undefined) {
      continue;
    }
    body.push(...bindings.statements);

    const fire = bindings.fire === null ? null : fireName(transition.name);
    if (bindings.fire === null) {
      body.push(comment(`${transition.description}: always enabled`));
    } else {
      body.push(assign(fireName(transition.name), bindings.fire, transition.description));
    }
    const fireRef = fire === null ? null : ref(fire);

    // Consumption: counts for plain places, present flags for coloured ones.
    for (const [place, weight] of transition.consumes) {
      if (!plan.layouts.has(place)) {
        body.push(assign(place, changedWhen(fireRef, ref(place), "-", weight)));
      }
    }
    for (const take of bindings.takes) {
      const taken = take.take === null ? fireRef : ref(take.take);
      const flag = presentName(take.place, take.slot);
      body.push(assign(flag, taken === null ? ref(flag) : binary("&", ref(flag), not(taken))));
    }
    for (const place of plan.capped.keys()) {
      const delta = transition.deltas.get(place) ?? 0;
      if (delta !== 0) {
        const fill = fillName(place);
        body.push(assign(fill, changedBy(fireRef, ref(fill), delta)));
      }
    }

    // Production: plain counts land at the end; coloured tokens are computed now, landed later.
    const colouredOutputs = transition.produces.filter(([place]) => plan.layouts.has(place));
    let outs = new Map<string, LinearExpr[][]>();
    if (colouredOutputs.length > 0) {
      if (transition.kernel === null) {
        errors.push({
          code: "kernel-missing",
          message: "the transition produces coloured tokens without a kernel",
          item,
        });
      } else {
        const kernelFn = transition.kernel;
        const kernel = attempt(item, errors, () =>
          lowerKernel(plan, transition, kernelFn, bindings.boundToken, sample),
        );
        if (kernel !== undefined) {
          body.push(...kernel.statements);
          outs = kernel.outs;
        }
      }
    }
    for (const [place, weight] of transition.produces) {
      if (plan.layouts.has(place)) {
        colouredProducers.get(place)?.push({ fire: fireRef, tokens: outs.get(place) ?? [] });
      } else {
        produced.get(place)?.push({ fire, weight });
      }
    }
  }

  // 4. Landing.
  body.push(comment(LAND_COMMENT));
  const returns: LinearExpr[] = [];
  const overflowing: string[] = [];
  for (const place of plan.places) {
    if (place.layout !== null) {
      const { statements, overflows } = lowerCompaction(
        place.layout,
        colouredProducers.get(place.name) ?? [],
      );
      body.push(...statements);
      if (overflows) {
        overflowing.push(place.name);
      }
      for (const variable of layoutVariables(place.layout)) {
        returns.push(ref(variable.name));
      }
      continue;
    }
    if (plan.capped.has(place.name)) {
      returns.push(ref(fillName(place.name)));
      continue;
    }
    for (const { fire, weight } of produced.get(place.name) ?? []) {
      body.push(
        assign(
          place.name,
          changedWhen(fire === null ? null : ref(fire), ref(place.name), "+", weight),
        ),
      );
    }
    returns.push(ref(place.name));
  }
  for (const place of overflowing) {
    returns.push(ref(overflowName(place)));
  }
  return { body, returns, drawVariables, overflowing };
}

/** `Plain Petri net with 2 places and 2 transitions. One next is one step of the net.` */
function netDocstring(plan: StepPlan): string {
  const coloured = plan.layouts.size;
  const kind = plan.kind === "mixed" ? "Mixed" : plan.facts.stochastic ? "Stochastic" : "Plain";
  const net = `${kind} ${coloured > 0 ? "coloured " : ""}Petri net`;
  const places = `${plural(plan.places.length, "place")}${coloured > 0 ? ` (${coloured} coloured)` : ""}`;
  const transitions = plural(plan.transitions.length, "transition");
  const dt =
    plan.facts.stochastic || plan.facts.dynamic ? `, dt = ${floatText(plan.options.dt)}` : "";
  return `${net} with ${places} and ${transitions}${dt}. One next is one step of the net.`;
}

function lowerMonolithic(plan: StepPlan, errors: Diagnostic[]): LinearGraph {
  const theory = markingTheory(plan);
  const placeVariables: LinearVariable[] = plan.places.flatMap((place) =>
    place.layout === null
      ? [
          {
            name: place.name,
            sort: theory === "LRA" ? "real" : "int",
            role: "place",
          } satisfies LinearVariable,
        ]
      : layoutVariables(place.layout),
  );
  const draws = drawModules(plan);
  const { body, returns, drawVariables, overflowing } = stepStatements(plan, errors);
  // A rate written as code is tested against an exponential draw per step.
  const exponentialInputs: LinearVariable[] = plan.transitions
    .filter((transition) => transition.rateCode !== null)
    .map((transition) => ({
      name: exponentialDrawName(transition.name),
      sort: "real",
      role: "input",
      comment: `exponential draw for ${transition.name}, each step: -ln(u) / dt`,
    }));
  const extl = [
    ...plan.transitions.flatMap((transition) => inputTerms(plan, transition).reads),
    ...exponentialInputs.map((variable) => variable.name),
    ...drawVariables.map((variable) => variable.name),
  ];
  const overflowVariables: LinearVariable[] = overflowing.map((place) => ({
    name: overflowName(place),
    sort: "bool",
    role: "flag",
    comment: `a token produced into ${place} found no free slot, at some step`,
  }));
  const init: LinearExpr[] = plan.places.flatMap((place) =>
    place.layout === null ? [num(place.initial)] : layoutInitialValues(place.layout, place.rows),
  );
  init.push(...overflowing.map(() => bool(false)));
  const names = netModuleNames(plan.name);
  const step: LinearModule = {
    ...names,
    docstring: netDocstring(plan),
    theory,
    ctrl: [
      ...placeVariables.map((variable) => variable.name),
      ...overflowVariables.map((variable) => variable.name),
    ],
    extl,
    init,
    next: body,
    returns,
  };
  return {
    language: "linear",
    variables: [
      ...placeVariables,
      ...inputVariables(plan),
      ...exponentialInputs,
      ...drawVariables,
      ...hitVariables(plan),
      ...overflowVariables,
    ],
    modules: [...draws, step],
    root:
      draws.length === 0
        ? { kind: "single", module: names.instance }
        : {
            kind: "compose",
            modules: [...draws.map((draw) => draw.instance), names.instance],
          },
  };
}

/** Refuses nothing up front: what it cannot express shows as it lowers each item. */
export const monolithic: Lowering = {
  refusals: () => [],
  lower: lowerMonolithic,
};
