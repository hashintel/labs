import { conflictingTransitions } from "./ir/accessors";
import { netItem } from "./ir/net-item";

import type { Diagnostic } from "./diagnostics";
import type { PetriNetIr } from "./ir/schema";

/**
 * How the compiler shapes its output. Each option names a strategy, with a
 * default that reproduces one step of the net in one module. The options
 * are passed beside the IR, never written in it.
 *
 * `OPTIONS` is the one table: each option's values, default, what it
 * decides, the nets it bears on, and why it does not apply to a net. The
 * types, the panel's rows, what the panel stores and the
 * `option-not-applicable` warnings all follow from it.
 */

/** What the applicability rules read off a net under the requested options. */
export type NetFacts = {
  /** Some transition has a rate. */
  stochastic: boolean;
  coloured: boolean;
  dynamic: boolean;
  controllable: boolean;
  /** Two transitions share an input place. */
  conflicting: boolean;
  /** Clock rates are asked for and apply: the composition is fixed and there is no step. */
  clocks: boolean;
};

type OptionRules = {
  /** What the option decides. */
  readonly summary: string;
  /** The nets it bears on, as prose for a reader. */
  readonly appliesTo: string;
  /** Why it has no effect on the net, or `undefined` when it applies. */
  notApplicable(net: NetFacts, options: ResolvedOptions): string | undefined;
};

export type OptionSpec = OptionRules & {
  /** The values to pick from, the default first; `null` for a positive number. */
  readonly values: readonly string[] | null;
  readonly default: string | number;
};

function choice<const Values extends readonly [string, ...string[]]>(
  rules: OptionRules & { values: Values },
): OptionRules & { readonly values: Values; readonly default: Values[0] } {
  return { ...rules, default: rules.values[0] };
}

function positiveNumber(
  rules: OptionRules & { default: number },
): OptionRules & { readonly values: null; readonly default: number } {
  return { ...rules, values: null };
}

const CLOCKS_HAVE_NO_STEP = "Clock rates compose the modules in continuous time; there is no step.";

export const OPTIONS = {
  shape: choice({
    values: ["monolithic", "modular"],
    summary:
      "Monolithic: one module holds the whole step. Modular: one module per transition drives a firing flag, one module per place awaits the flags of its transitions, and the modules are composed.",
    appliesTo: "every net under coins",
    notApplicable: (net) => (net.clocks ? CLOCKS_HAVE_NO_STEP : undefined),
  }),
  rates: choice({
    values: ["coin", "clock"],
    summary:
      "Coin: a rate is tested against a uniform draw each step of dt, in a linear theory. Clock: in the SPN theory, each transition owns a clock armed with exp(rate) and an event it toggles when it fires, each place is a Nat counter, and time is continuous.",
    appliesTo: "a stochastic net without colours or dynamics",
    notApplicable: (net) =>
      !net.stochastic
        ? "A plain net has no rates to test."
        : net.coloured || net.dynamic
          ? "A coloured net, or one with dynamics, compiles under coins only."
          : undefined,
  }),
  conflicts: choice({
    values: ["sweep", "nondet"],
    summary:
      "Sweep: transitions that share an input place fire in record order, and a later one reads the marking the earlier ones left. Nondet: each transition in a conflict also waits for a Bool pick that nothing drives, so a proof ranges over every way the conflict resolves.",
    appliesTo: "a net where two transitions share an input place",
    notApplicable: (net) =>
      net.conflicting ? undefined : "No two transitions share an input place.",
  }),
  marking: choice({
    values: ["real", "int"],
    summary:
      "Real: every place is a Real and each guard tests its own draw. Int: places are Int, and one LRA module per transition turns its draw into a Bool flag the guard reads.",
    appliesTo: "a stochastic uncoloured net under coins",
    notApplicable: (net) =>
      net.clocks
        ? "Clock rates count in Nat."
        : !net.stochastic
          ? "A plain net counts in Int."
          : net.coloured
            ? "A coloured place's slots are Real."
            : undefined,
  }),
  control: choice({
    values: ["closed", "open"],
    summary:
      "Closed: a controllable transition fires whenever it is enabled. Open: it also waits for a Bool choice from outside, so the module is open to a controller.",
    appliesTo: "a net with a controllable transition, under coins",
    notApplicable: (net) =>
      net.clocks
        ? "Clock rates take no external choice."
        : net.controllable
          ? undefined
          : "No transition is marked controllable.",
  }),
  dt: positiveNumber({
    default: 1,
    summary: "The step length: a rate is tested over it, and dynamics take one Euler step of it.",
    appliesTo: "a net with rates or dynamics, under coins",
    notApplicable: (net) =>
      net.clocks
        ? CLOCKS_HAVE_NO_STEP
        : net.stochastic || net.dynamic
          ? undefined
          : "A plain net without dynamics has no step length to test over.",
  }),
  slots: positiveNumber({
    default: 8,
    summary:
      "The slots a coloured place without a capacity gets. A produced token that finds no free slot sets the place's overflow flag.",
    appliesTo: "a coloured net",
    notApplicable: (net) => (net.coloured ? undefined : "No place is coloured."),
  }),
  layout: choice({
    values: ["single", "per-module"],
    summary:
      "Single: one Python file holds the variables, the modules and the system. Per-module: each module class has a file of its own, and net.py declares the variables, imports the modules and composes them.",
    appliesTo: "a net under the modular shape or clock rates",
    // The annotations keep this rule's type from depending on the types derived from OPTIONS.
    notApplicable: (net: NetFacts, options: ResolvedOptions): string | undefined =>
      options.shape === "modular" || net.clocks
        ? undefined
        : "One module needs one file; the modular shape or clock rates compose.",
  }),
} satisfies Record<string, OptionSpec>;

export type OptionName = keyof typeof OPTIONS;

type OptionValue<Spec> = Spec extends { readonly values: readonly (infer Value)[] }
  ? Value
  : number;

/** The options a caller asks for; one left out takes its default. */
export type CompilerOptions = { [Name in OptionName]?: OptionValue<(typeof OPTIONS)[Name]> };

export type ResolvedOptions = Required<CompilerOptions>;

/** Every option, in the order of `OPTIONS`. */
export const OPTION_NAMES = Object.keys(OPTIONS) as OptionName[];

/** Every option: the value given, or the default. */
export function resolveOptions(options: CompilerOptions = {}): ResolvedOptions {
  return Object.fromEntries(
    OPTION_NAMES.map((name) => [name, options[name] ?? OPTIONS[name].default]),
  ) as ResolvedOptions;
}

export function netFacts(ir: PetriNetIr, options?: CompilerOptions): NetFacts {
  const places = Object.values(ir.places);
  const transitions = Object.values(ir.transitions);
  const resolved = resolveOptions(options);
  const net: NetFacts = {
    stochastic: transitions.some((transition) => transition.rate !== undefined),
    coloured: places.some((place) => place?.colour !== undefined),
    dynamic: places.some((place) => place?.dynamics !== undefined),
    controllable: transitions.some((transition) => transition.controllable === true),
    conflicting: conflictingTransitions(ir.transitions).size > 0,
    clocks: false,
  };
  // The rates rule says when clocks apply; it reads no fact that depends on clocks.
  return {
    ...net,
    clocks: resolved.rates === "clock" && OPTIONS.rates.notApplicable(net, resolved) === undefined,
  };
}

/** One option as the panel shows it for a net. */
export type OptionState = {
  name: OptionName;
  /** The value in force: the one given, or the default. */
  value: string;
  values: readonly string[] | null;
  /** Why the option has no effect on this net; absent when it applies. */
  notApplicable?: string;
};

export function optionStates(ir: PetriNetIr, options?: CompilerOptions): OptionState[] {
  const net = netFacts(ir, options);
  const resolved = resolveOptions(options);
  return OPTION_NAMES.map((name) => {
    const reason = OPTIONS[name].notApplicable(net, resolved);
    return {
      name,
      value: String(resolved[name]),
      values: OPTIONS[name].values,
      ...(reason === undefined ? {} : { notApplicable: reason }),
    };
  });
}

/** The options that bear on the net: those that apply and are off their default. */
export function optionsForNet(
  options: CompilerOptions | undefined,
  ir: PetriNetIr,
): CompilerOptions {
  const resolved = resolveOptions(options);
  return Object.fromEntries(
    optionStates(ir, options).flatMap(({ name, notApplicable }) =>
      notApplicable === undefined && resolved[name] !== OPTIONS[name].default
        ? [[name, resolved[name]]]
        : [],
    ),
  );
}

/**
 * One `option-not-applicable` warning per option asked for off its default
 * that does not apply to the net, with the reason the panel shows.
 */
export function droppedOptions(options: CompilerOptions | undefined, ir: PetriNetIr): Diagnostic[] {
  const resolved = resolveOptions(options);
  return optionStates(ir, options).flatMap(({ name, value, notApplicable }) =>
    notApplicable === undefined || resolved[name] === OPTIONS[name].default
      ? []
      : [
          {
            code: "option-not-applicable",
            message: `${name}: ${value} is ignored. ${notApplicable}`,
            item: netItem(ir.name),
          },
        ],
  );
}
