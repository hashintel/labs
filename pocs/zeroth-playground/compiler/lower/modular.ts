import {
  assign,
  bool,
  changedBy,
  changedWhen,
  conjunction,
  next,
  num,
  type LinearExpr,
  type LinearModule,
  type LinearGraph,
  type LinearStatement,
  type LinearVariable,
  ref,
} from "../graph/linear-graph";
import { netItem } from "../ir/net-item";
import { netFacts } from "../options";
import {
  availableName,
  fillName,
  fireName,
  placeModuleNames,
  transitionModuleNames,
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
import type { PetriNetIr } from "../ir/schema";
import type { Lowering } from "./lowering";
import type { PlannedPlace, PlannedTransition, StepPlan } from "./step-plan";

/**
 * The modular shape, after Zeroth's own Petri net examples: one module per
 * transition drives a Bool flag that says it fires this round, one module
 * per place awaits the flags of its transitions and applies their tokens,
 * and the modules are composed into the system.
 *
 * A transition module reads its places latched, so it rebuilds the view a
 * sweep gives it by awaiting the flags of the earlier transitions that take
 * from the same place, or move tokens in a capped place it fills: the
 * firings are the ones one step of the net decides, and each place's next
 * value is the step's result. The awaits run from a transition to earlier
 * ones and from a place to its transitions, so they form a DAG.
 */

/** Adds `name` once, keeping first-seen order. */
function read(reads: string[], name: string): void {
  if (!reads.includes(name)) {
    reads.push(name);
  }
}

type Guard = {
  statements: LinearStatement[];
  terms: LinearExpr[];
  reads: string[];
};

/**
 * The tokens an input place holds once the earlier transitions taking from
 * it have consumed theirs: the place, less each earlier firing's weight.
 */
function availableTokens(place: string, earlier: PlannedTransition[], guard: Guard): LinearExpr {
  const takers = earlier.filter((transition) =>
    transition.consumes.some(([taken]) => taken === place),
  );
  read(guard.reads, place);
  if (takers.length === 0) {
    return ref(place);
  }
  const available = availableName(place);
  guard.statements.push(assign(available, ref(place)));
  for (const taker of takers) {
    const weight = taker.consumes.find(([taken]) => taken === place)?.[1] ?? 0;
    read(guard.reads, fireName(taker.name));
    guard.statements.push(
      assign(
        available,
        changedWhen(next(fireName(taker.name)), ref(available), "-", weight),
        `${taker.name} took ${weight}`,
      ),
    );
  }
  return ref(available);
}

/**
 * The tokens a capped place would hold if the step ended after the earlier
 * transitions: the place, plus each earlier firing's net change to it.
 */
function fillTokens(place: string, earlier: PlannedTransition[], guard: Guard): LinearExpr {
  const movers = earlier.filter((transition) => (transition.deltas.get(place) ?? 0) !== 0);
  read(guard.reads, place);
  if (movers.length === 0) {
    return ref(place);
  }
  const fill = fillName(place);
  guard.statements.push(assign(fill, ref(place)));
  for (const mover of movers) {
    const delta = mover.deltas.get(place) ?? 0;
    read(guard.reads, fireName(mover.name));
    guard.statements.push(
      assign(
        fill,
        changedBy(next(fireName(mover.name)), ref(fill), delta),
        `${mover.name} ${delta > 0 ? "added" : "took"} ${Math.abs(delta)}`,
      ),
    );
  }
  return ref(fill);
}

function transitionModule(
  plan: StepPlan,
  transition: PlannedTransition,
  index: number,
): LinearModule {
  const earlier = plan.transitions.slice(0, index);
  const guard: Guard = { statements: [], terms: [], reads: [] };
  for (const arc of transition.inputArcs) {
    guard.terms.push(arcTest(arc, availableTokens(arc.place, earlier, guard)));
  }
  for (const [place, capacity] of plan.capped) {
    const delta = transition.deltas.get(place) ?? 0;
    if (delta > 0) {
      guard.terms.push(roomTest(fillTokens(place, earlier, guard), delta, capacity));
    }
  }
  const inputs = inputTerms(plan, transition);
  guard.terms.push(...inputs.terms);
  for (const name of inputs.reads) {
    read(guard.reads, name);
  }
  const fires = conjunction(guard.terms);
  const rate = transition.rate === null ? "" : `, at rate ${transition.rate}`;
  return {
    ...transitionModuleNames(transition.name),
    docstring: `${transition.description}${rate}${fires === null ? ", always enabled" : ""}`,
    theory: markingTheory(plan),
    ctrl: [fireName(transition.name)],
    extl: guard.reads,
    init: [bool(false)],
    next: guard.statements,
    returns: [fires ?? bool(true)],
  };
}

function placeModule(plan: StepPlan, place: PlannedPlace): LinearModule {
  const { name } = place;
  const movers = plan.transitions.flatMap((transition) => {
    const delta = transition.deltas.get(name);
    return delta === undefined ? [] : [{ transition: transition.name, delta }];
  });
  const statements: LinearStatement[] = movers.map(({ transition, delta }) =>
    assign(
      name,
      changedBy(next(fireName(transition)), ref(name), delta),
      `${transition} ${delta > 0 ? "adds" : "takes"} ${Math.abs(delta)}`,
    ),
  );
  const takers = movers.filter(({ delta }) => delta < 0).map(({ transition }) => transition);
  const adders = movers.filter(({ delta }) => delta > 0).map(({ transition }) => transition);
  const flows = [
    ...(takers.length === 0 ? [] : [`taken by ${takers.join(", ")}`]),
    ...(adders.length === 0 ? [] : [`added by ${adders.join(", ")}`]),
  ];
  return {
    ...placeModuleNames(name),
    docstring: `${name}: ${flows.length === 0 ? "no transition moves its tokens" : flows.join(", ")}`,
    theory: markingTheory(plan),
    ctrl: [name],
    extl: movers.map(({ transition }) => fireName(transition)),
    init: [num(place.initial)],
    next: statements,
    returns: [ref(name)],
  };
}

function lowerModular(plan: StepPlan): LinearGraph {
  const theory = markingTheory(plan);
  const placeVariables: LinearVariable[] = plan.places.map((place) => ({
    name: place.name,
    sort: theory === "LRA" ? "real" : "int",
    role: "place",
  }));
  const fireVariables: LinearVariable[] = plan.transitions.map((transition) => ({
    name: fireName(transition.name),
    sort: "bool",
    role: "flag",
    comment: `${transition.name} fires this step`,
  }));
  const modules: LinearModule[] = [
    ...drawModules(plan),
    ...plan.transitions.map((transition, index) => transitionModule(plan, transition, index)),
    ...plan.places.map((place) => placeModule(plan, place)),
  ];
  return {
    language: "linear",
    variables: [
      ...placeVariables,
      ...inputVariables(plan),
      ...hitVariables(plan),
      ...fireVariables,
    ],
    modules,
    root: {
      kind: "compose",
      modules: modules.map((module) => module.instance),
    },
  };
}

/** The modular shape is not lowered for coloured places or dynamics yet. */
function modularRefusals(ir: PetriNetIr): Diagnostic[] {
  const { coloured, dynamic } = netFacts(ir);
  return coloured || dynamic
    ? [
        {
          code: "modular-coloured-not-lowered",
          message:
            "the modular shape is not lowered for a net with coloured places or dynamics yet; use the monolithic shape",
          item: netItem(ir.name),
        },
      ]
    : [];
}

export const modular: Lowering = {
  refusals: modularRefusals,
  lower: lowerModular,
};
