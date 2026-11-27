import {
  assign,
  binary,
  conjunction,
  disjunction,
  ite,
  next,
  not,
  type LinearExpr,
  type LinearStatement,
  ref,
} from "../../graph/linear-graph";
import { slotToken } from "../colour-layout";
import { refuse, within } from "../../diagnostics";
import {
  type LinearCodeEnv,
  type TokenBinding,
  translateGuard,
  translateRate,
} from "../../code/linear-code";
import {
  bindName,
  enabledName,
  exponentialDrawName,
  presentName,
  seenName,
  selectName,
  takeName,
} from "../names";
import { inputTokenCount } from "../step-plan";

import type { CodeFunction } from "../../code/code-tree";
import type { PlannedArc, PlannedTransition, StepPlan } from "../step-plan";

/**
 * A transition's bindings: which tokens of its coloured input places it
 * takes, in the order a step tries them. A step enumerates the
 * combinations of token indices per arc, ascending and lexicographic, with
 * the last arc advancing fastest, and fires the first one whose guard holds.
 * Here every combination gets a Bool, the first passing one is selected with
 * an exclusion chain, and a bound attribute the kernel reads is the `ite`
 * chain over the selections.
 *
 * Because present slots form a dense prefix and consumption only clears
 * flags in slot order, the k-th present slot is the token at index k.
 */

export type Bindings = {
  statements: LinearStatement[];
  /** The firing condition, or `null` when nothing can stop the firing. */
  fire: LinearExpr | null;
  /** Slots the firing consumes, with the Bool that says so; `null` means the firing itself. */
  takes: { place: string; slot: number; take: string | null }[];
  /** `input.<Place>[index]` as the kernel sees it: the bound token's attributes. */
  boundToken: (place: string, index: number) => TokenBinding | undefined;
};

export type BindingsContext = {
  plan: StepPlan;
  transition: PlannedTransition;
  /** Terms every combination shares: counts, capacities, the draw or choice. */
  sharedTerms: LinearExpr[];
  /** The present flag of a slot as the sweep has left it so far. */
  present: (place: string, slot: number) => LinearExpr;
  sample: LinearCodeEnv["sample"];
};

/** Ascending k-subsets of 0..n-1 in lexicographic order. */
function combinations(count: number, size: number): number[][] {
  const result: number[][] = [];
  function build(start: number, chosen: number[]): void {
    if (chosen.length === size) {
      result.push([...chosen]);
      return;
    }
    for (let slot = start; slot < count; slot++) {
      chosen.push(slot);
      build(slot + 1, chosen);
      chosen.pop();
    }
  }
  build(0, []);
  return result;
}

/** The cartesian product in arc order, the last arc advancing fastest. */
function product(perArc: number[][][]): number[][][] {
  return perArc.reduce<number[][][]>(
    (acc, tuples) => acc.flatMap((prefix) => tuples.map((tuple) => [...prefix, tuple])),
    [[]],
  );
}

/** The arcs whose tokens carry attributes and are bound: coloured, not inhibiting. */
function bindingArcs(plan: StepPlan, transition: PlannedTransition): PlannedArc[] {
  return transition.inputArcs.filter(
    (arc) => arc.kind !== "inhibitor" && plan.layouts.has(arc.place),
  );
}

function envFor(
  context: BindingsContext,
  arcs: PlannedArc[],
  combination: number[][],
): LinearCodeEnv {
  return {
    inputName: "input",
    token: (place, index) => {
      const position = arcs.findIndex((arc) => arc.place === place);
      const layout = context.plan.layouts.get(place);
      const slot = combination[position]?.[index];
      return position === -1 || layout === undefined || slot === undefined
        ? undefined
        : slotToken(layout, slot);
    },
    tokenCount: inputTokenCount(context.transition),
    sample: context.sample,
  };
}

/** The guard or rate test of one combination, or `null` when the code reads nothing. */
function lambdaTerm(context: BindingsContext, env: LinearCodeEnv): LinearExpr | null {
  const { transition } = context;
  function named(fn: CodeFunction): LinearCodeEnv {
    return {
      ...env,
      inputName: fn.params[0]?.name ?? env.inputName,
    };
  }
  if (transition.guard !== null) {
    const guard = transition.guard;
    return within("guard", () => translateGuard(guard, named(guard)));
  }
  if (transition.rateCode !== null) {
    const rate = transition.rateCode;
    // exp(-rate * dt) <= u  is  rate >= -ln(u) / dt, the exponential draw.
    return within("rate", () =>
      binary(">=", translateRate(rate, named(rate)), next(exponentialDrawName(transition.name))),
    );
  }
  return null;
}

export function lowerBindings(context: BindingsContext): Bindings {
  const { plan, transition } = context;
  const arcs = bindingArcs(plan, transition);
  const perArc = arcs.map((arc) =>
    combinations(plan.layouts.get(arc.place)?.slots ?? 0, arc.weight),
  );
  const tuples = product(perArc);
  if (tuples.length > 4096) {
    refuse(
      "binding-explosion",
      `${tuples.length} token combinations to try; the module would be too large`,
    );
  }
  const statements: LinearStatement[] = [];
  const shared = conjunction(context.sharedTerms);

  function presenceTerms(combination: number[][]): LinearExpr[] {
    return arcs.flatMap((arc, position) =>
      (combination[position] ?? []).map((slot) => context.present(arc.place, slot)),
    );
  }

  // One combination: the firing is the conjunction, with no selection chain.
  if (tuples.length === 1) {
    const [combination] = tuples;
    const env = envFor(context, arcs, combination ?? []);
    const lambda = lambdaTerm(context, env);
    const fire = conjunction([
      ...(shared === null ? [] : [shared]),
      ...presenceTerms(combination ?? []),
      ...(lambda === null ? [] : [lambda]),
    ]);
    const takes = arcs.flatMap((arc, position) =>
      arc.kind === "standard"
        ? (combination?.[position] ?? []).map((slot) => ({
            place: arc.place,
            slot,
            take: null,
          }))
        : [],
    );
    return {
      statements,
      fire,
      takes,
      boundToken: (place, index) => envFor(context, arcs, combination ?? []).token(place, index),
    };
  }

  // Several combinations: shared terms once, one Bool per combination, first match wins.
  const enabled = enabledName(transition.name);
  if (shared !== null) {
    statements.push(assign(enabled, shared, "every combination needs this"));
  }
  const seen = seenName(transition.name);
  tuples.forEach((combination, index) => {
    const env = envFor(context, arcs, combination);
    const lambda = lambdaTerm(context, env);
    const terms = [
      ...(shared === null ? [] : [ref(enabled)]),
      ...presenceTerms(combination),
      ...(lambda === null ? [] : [lambda]),
    ];
    const described = arcs
      .map((arc, position) => `${arc.place}[${(combination[position] ?? []).join(", ")}]`)
      .join(" ");
    statements.push(
      assign(bindName(transition.name, index), conjunction(terms) ?? ref(enabled), described),
    );
    if (index === 0) {
      statements.push(assign(selectName(transition.name, 0), ref(bindName(transition.name, 0))));
      statements.push(assign(seen, ref(bindName(transition.name, 0))));
    } else {
      statements.push(
        assign(
          selectName(transition.name, index),
          binary("&", ref(bindName(transition.name, index)), not(ref(seen))),
        ),
      );
      statements.push(assign(seen, binary("|", ref(seen), ref(bindName(transition.name, index)))));
    }
  });

  const takes: Bindings["takes"] = [];
  arcs.forEach((arc, position) => {
    if (arc.kind !== "standard") {
      return;
    }
    const slots = new Set(tuples.flatMap((combination) => combination[position] ?? []));
    for (const slot of [...slots].toSorted((left, right) => left - right)) {
      const selections = tuples
        .map((combination, index) => ({ combination, index }))
        .filter(({ combination }) => (combination[position] ?? []).includes(slot))
        .map(({ index }) => ref(selectName(transition.name, index)));
      const take = takeName(transition.name, arc.place, slot);
      statements.push(assign(take, disjunction(selections) ?? ref(seen)));
      takes.push({ place: arc.place, slot, take });
    }
  });

  function boundToken(place: string, index: number): TokenBinding | undefined {
    const position = arcs.findIndex((arc) => arc.place === place);
    const layout = plan.layouts.get(place);
    if (position === -1 || layout === undefined) {
      return undefined;
    }
    const slots = tuples.map((combination) => combination[position]?.[index]);
    if (slots.some((slot) => slot === undefined)) {
      return undefined;
    }
    return slotToken(layout, 0, (attribute) => {
      // The chosen combination's slot, first match first; the last stands unguarded.
      let chain: LinearExpr | null = null;
      for (let choice = tuples.length - 1; choice >= 0; choice--) {
        const slot = slots[choice] ?? 0;
        const value = slotToken(layout, slot).attribute(attribute.name);
        const expr = value !== undefined && !("refused" in value) ? value.expr : ref("_");
        chain = chain === null ? expr : ite(ref(selectName(transition.name, choice)), expr, chain);
      }
      return chain ?? ref(presentName(place, 0));
    });
  }

  return { statements, fire: ref(seen), takes, boundToken };
}
