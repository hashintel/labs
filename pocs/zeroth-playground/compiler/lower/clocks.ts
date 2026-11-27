import {
  and,
  assign,
  bool,
  conjunction,
  dec,
  exp,
  fired,
  ifThen,
  inc,
  isZero,
  ite,
  nat,
  nonNegative,
  nonZero,
  not,
  rate,
  ref,
  zeroFlow,
  type SpnExpr,
  type SpnModule,
  type SpnGraph,
  type SpnVariable,
} from "../graph/spn-graph";
import {
  clockName,
  eventName,
  firedName,
  firesName,
  pickName,
  placeModuleNames,
  timeReference,
  transitionModuleNames,
} from "./names";
import { clockRefusals } from "./clocks/refusals";
import { pickApplies } from "./guard-inputs";

import type { Lowering } from "./lowering";
import type { PlannedPlace, PlannedTransition, StepPlan } from "./step-plan";

/**
 * The clocks strategy, after Zeroth's `birth_death.py` in the SPN theory:
 * one module per transition owns a clock and an event, one module per
 * place counts tokens as it awaits the events, and the clocks are hidden.
 *
 * A transition's clock is armed with an exponential delay at its rate, runs
 * down against the time reference while its input arcs allow a firing, and
 * is re-armed when it expires; the event toggles on the same step. A
 * transition in a conflict the options leave open also needs the
 * environment's pick, an external Bool nothing drives, at the expiry: with
 * the pick false its clock stays at zero. A place applies one exclusive
 * case per transition that moves its tokens: the theory moves one token at
 * a time and time stops at the first expiry, so two events never toggle in
 * one step.
 */

function timeRate(factor: number): SpnExpr {
  return rate(factor, timeReference);
}

/** Each input arc as the test its place must pass: empty for an inhibitor arc, non-empty otherwise. */
function arcTerms(transition: PlannedTransition): SpnExpr[] {
  return transition.inputArcs.map((arc) =>
    arc.kind === "inhibitor" ? isZero(ref(arc.place)) : nonZero(ref(arc.place)),
  );
}

function transitionModule(plan: StepPlan, transition: PlannedTransition): SpnModule {
  if (transition.rate === null) {
    throw new Error(`${transition.name} has no constant rate to arm a clock with`);
  }
  const clock = clockName(transition.name);
  const event = eventName(transition.name);
  const fires = firesName(transition.name);
  const terms = arcTerms(transition);
  const enabled = conjunction(terms);
  const picks = pickApplies(plan, transition) ? [pickName(transition.name)] : [];
  const armed = exp(transition.rate);
  return {
    ...transitionModuleNames(transition.name),
    docstring: `${transition.description}, at rate ${transition.rate}`,
    ctrl: [clock, event],
    extl: [...transition.inputArcs.map((arc) => arc.place), ...picks, timeReference],
    init: [armed, bool(false)],
    next: [
      assign(
        fires,
        [...terms, ...picks.map(ref)].reduce((all, term) => and(all, term), isZero(ref(clock))),
      ),
    ],
    returns: [ite(ref(fires), armed, ref(clock)), ifThen(ref(fires), not(ref(event)))],
    flow: [
      ifThen(
        nonNegative(clock),
        enabled === null ? timeRate(-1) : ite(enabled, timeRate(-1), timeRate(0)),
      ),
      zeroFlow(),
    ],
  };
}

type Mover = { transition: string; adds: boolean };

/** The transitions that change a place's count: the producers first, then the consumers. */
function moversOf(plan: StepPlan, place: string): Mover[] {
  const deltas = plan.transitions.map((transition) => ({
    transition: transition.name,
    delta: transition.deltas.get(place) ?? 0,
  }));
  return [
    ...deltas.filter(({ delta }) => delta > 0),
    ...deltas.filter(({ delta }) => delta < 0),
  ].map(({ transition, delta }) => ({ transition, adds: delta > 0 }));
}

/**
 * The count after the step: one case per mover, taken when its event alone
 * toggled and, for a consumer, the place holds a token; the count otherwise.
 */
function nextCount(place: string, movers: Mover[]): SpnExpr {
  return movers.reduceRight<SpnExpr>((rest, mover, index) => {
    const others = movers.filter((_, otherIndex) => otherIndex !== index);
    const guard = [
      ...others.map((other) => not(ref(firedName(other.transition)))),
      ...(mover.adds ? [] : [nonZero(ref(place))]),
    ].reduce((all, term) => and(all, term), ref(firedName(mover.transition)));
    return ite(guard, mover.adds ? inc(ref(place)) : dec(ref(place)), rest);
  }, ref(place));
}

function placeModule(plan: StepPlan, place: PlannedPlace): SpnModule {
  const movers = moversOf(plan, place.name);
  const adders = movers.filter((mover) => mover.adds);
  const takers = movers.filter((mover) => !mover.adds);
  const flows = [
    ...(adders.length === 0
      ? []
      : [`added by ${adders.map((mover) => mover.transition).join(", ")}`]),
    ...(takers.length === 0
      ? []
      : [`taken by ${takers.map((mover) => mover.transition).join(", ")}`]),
  ];
  return {
    ...placeModuleNames(place.name),
    docstring: `${place.name}: ${flows.length === 0 ? "no transition moves its tokens" : flows.join(", ")}`,
    ctrl: [place.name],
    extl: movers.map((mover) => eventName(mover.transition)),
    init: [nat(place.initial)],
    next: movers.map((mover) =>
      assign(firedName(mover.transition), fired(eventName(mover.transition))),
    ),
    returns: [nextCount(place.name, movers)],
  };
}

function lowerClocks(plan: StepPlan): SpnGraph {
  const variables: SpnVariable[] = [
    {
      name: timeReference,
      sort: "clock",
      role: "time",
      comment: "the time reference",
    },
    ...plan.places.map((place): SpnVariable => ({
      name: place.name,
      sort: "nat",
      role: "place",
    })),
    ...plan.transitions.map((transition): SpnVariable => ({
      name: clockName(transition.name),
      sort: "clock",
      role: "clock",
      comment: `time left until ${transition.name} fires`,
    })),
    ...plan.transitions.map((transition): SpnVariable => ({
      name: eventName(transition.name),
      sort: "event",
      role: "event",
      comment: `toggles when ${transition.name} fires`,
    })),
    ...plan.transitions
      .filter((transition) => pickApplies(plan, transition))
      .map((transition): SpnVariable => ({
        name: pickName(transition.name),
        sort: "bool",
        role: "pick",
        comment: `the environment lets ${transition.name} fire when its clock expires`,
      })),
  ];
  return {
    language: "spn",
    variables,
    modules: [
      ...plan.transitions.map((transition) => transitionModule(plan, transition)),
      ...plan.places.map((place) => placeModule(plan, place)),
    ],
    hidden: plan.transitions.map((transition) => clockName(transition.name)),
  };
}

export const clocks: Lowering = {
  refusals: clockRefusals,
  lower: lowerClocks,
};
