import {
  binary,
  bool,
  next,
  num,
  type LinearExpr,
  type LinearModule,
  type Theory,
  type LinearVariable,
} from "../graph/linear-graph";
import { choiceName, drawModuleNames, drawName, hitName, pickName } from "./names";

import type { PlannedTransition, StepPlan } from "./step-plan";

/**
 * The parts of a transition's guard that do not depend on the marking, and
 * the variables and modules they need: the draw test of a stochastic
 * transition, the choice of a controllable one and the pick of one in a
 * conflict the options leave open. Both shapes read them.
 */

/** A coloured net or one with dynamics holds Reals, so it is lowered in LRA. */
function needsReals(plan: StepPlan): boolean {
  return plan.facts.coloured || plan.facts.dynamic;
}

/** Whether the draw tests live in modules of their own, with Int places. */
function drawsAreModules(plan: StepPlan): boolean {
  return plan.facts.stochastic && plan.options.marking === "int" && !needsReals(plan);
}

/** The theory the places and the transitions are typed in. */
export function markingTheory(plan: StepPlan): Theory {
  return needsReals(plan) || (plan.facts.stochastic && plan.options.marking === "real")
    ? "LRA"
    : "LIA";
}

function choiceApplies(plan: StepPlan, transition: PlannedTransition): boolean {
  return transition.controllable && plan.options.control === "open";
}

/**
 * Whether the transition waits for the environment's pick: it shares an
 * input place with another and the options leave the conflict open. The pick
 * is an input nothing drives, so every resolution is a run of the module.
 */
export function pickApplies(plan: StepPlan, transition: PlannedTransition): boolean {
  return transition.conflicting && plan.options.conflicts === "nondet";
}

/** One input a guard reads: the variable it declares, the guard's term, and the variable the term reads. */
type GuardInput = { declares: LinearVariable; term: LinearExpr; reads: string };

/** A Bool input the guard awaits as it is. */
function boolInput(name: string, comment: string): GuardInput {
  return {
    declares: { name, sort: "bool", role: "input", comment },
    term: next(name),
    reads: name,
  };
}

/** A transition's draw, choice and pick inputs, in that order. */
function guardInputs(plan: StepPlan, transition: PlannedTransition): GuardInput[] {
  const { name, threshold } = transition;
  const draw: GuardInput[] =
    threshold === null
      ? []
      : [
          {
            declares: {
              name: drawName(name),
              sort: "real",
              role: "input",
              comment: `uniform draw for ${name}, each step`,
            },
            ...(drawsAreModules(plan)
              ? { term: next(hitName(name)), reads: hitName(name) }
              : {
                  term: binary(">=", next(drawName(name)), num(threshold)),
                  reads: drawName(name),
                }),
          },
        ];
  return [
    ...draw,
    ...(choiceApplies(plan, transition)
      ? [boolInput(choiceName(name), `choice for ${name}, each step: it fires only when chosen`)]
      : []),
    ...(pickApplies(plan, transition)
      ? [boolInput(pickName(name), `the environment lets ${name} fire this step`)]
      : []),
  ];
}

/** The draw, choice and pick inputs, in transition order, each declared once. */
export function inputVariables(plan: StepPlan): LinearVariable[] {
  return plan.transitions.flatMap((transition) =>
    guardInputs(plan, transition).map((input) => input.declares),
  );
}

/**
 * The guard terms that do not read the marking, with the variables they
 * read: the draw test (or the draw module's flag), the choice and the pick.
 */
export function inputTerms(
  plan: StepPlan,
  transition: PlannedTransition,
): { terms: LinearExpr[]; reads: string[] } {
  const inputs = guardInputs(plan, transition);
  return { terms: inputs.map((input) => input.term), reads: inputs.map((input) => input.reads) };
}

/** The transitions whose draw is tested in a module of its own, in sweep order. */
function drawTransitions(plan: StepPlan): PlannedTransition[] {
  return drawsAreModules(plan)
    ? plan.transitions.filter((transition) => transition.threshold !== null)
    : [];
}

/** The Bool each draw module drives. */
export function hitVariables(plan: StepPlan): LinearVariable[] {
  return drawTransitions(plan).map((transition) => ({
    name: hitName(transition.name),
    sort: "bool",
    role: "flag",
    comment: `${transition.name}'s draw passed its threshold`,
  }));
}

/** One LRA module per transition: its draw against its threshold, as a Bool. */
export function drawModules(plan: StepPlan): LinearModule[] {
  return drawTransitions(plan).map((transition) => ({
    ...drawModuleNames(transition.name),
    docstring: `${transition.name} at rate ${transition.rate ?? 0} fires within a step of dt = ${plan.options.dt} when its draw is at least e^(-${transition.rate ?? 0} * ${plan.options.dt})`,
    theory: "LRA",
    ctrl: [hitName(transition.name)],
    extl: [drawName(transition.name)],
    init: [bool(false)],
    next: [],
    returns: [binary(">=", next(drawName(transition.name)), num(transition.threshold ?? 0))],
  }));
}
