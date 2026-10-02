import type { OptionName } from "../../compiler";

/**
 * How the compiler options read in the panel: grouped by what they decide,
 * each with a label, a one-line hint and labels for its values. An option
 * that only matters through another one names it in `under` and sits nested
 * beneath it. The values themselves are the compiler's.
 */

export type OptionChoice = { value: string; label: string };

export type OptionLabels = {
  name: OptionName;
  label: string;
  hint: string;
  /** The option this one depends on, drawn above it. */
  under?: OptionName;
  /** The values in the order the menu lists them; absent for a number. */
  choices?: readonly OptionChoice[];
};

/** A value as the panel shows it: its choice's label, or the number as written. */
export function valueLabel(labels: OptionLabels, value: string): string {
  return labels.choices?.find((choice) => choice.value === value)?.label ?? value;
}

/**
 * What an option that does not apply reads in place of a value. The default
 * it would show has no effect on the net: under clock rates, Shape would
 * read monolithic over composed modules.
 */
export const NOT_USED = "not used";

export type OptionSection = {
  title: string;
  /** What the section's options decide. */
  about: string;
  options: readonly OptionLabels[];
};

export const OPTION_SECTIONS: readonly OptionSection[] = [
  {
    title: "Structure",
    about: "How the net becomes modules and files",
    options: [
      {
        name: "shape",
        label: "Shape",
        hint: "Modular: one module per transition and per place, composed. Monolithic: one module whose next method is a whole step. Coloured nets compile monolithic only.",
        choices: [
          { value: "modular", label: "modular" },
          { value: "monolithic", label: "monolithic" },
        ],
      },
      {
        name: "layout",
        label: "Files",
        under: "shape",
        hint: "A composed system in one Python file, or net.py plus one file per module.",
        choices: [
          { value: "single", label: "one file" },
          { value: "per-module", label: "one per module" },
        ],
      },
    ],
  },
  {
    title: "Rates",
    about: "How a stochastic transition's rate becomes a firing",
    options: [
      {
        name: "rates",
        label: "Rates",
        hint: "Coin: a draw tested each step of dt, in LIA or LRA. Clock: an exponential clock in continuous time, in SPN.",
        choices: [
          { value: "coin", label: "coin" },
          { value: "clock", label: "clock" },
        ],
      },
      {
        name: "dt",
        label: "Time step",
        under: "rates",
        hint: "The step a coin is tested over and dynamics advance by.",
      },
      {
        name: "marking",
        label: "Marking",
        under: "rates",
        hint: "Real places, or Int places with one LRA draw module per transition.",
        choices: [
          { value: "real", label: "Real" },
          { value: "int", label: "Int" },
        ],
      },
    ],
  },
  {
    title: "Choices",
    about: "Who decides what a step's sweep would decide",
    options: [
      {
        name: "conflicts",
        label: "Conflicts",
        hint: "Sweep: record order settles a shared input place. Nondet: each transition in a conflict waits for a pick input.",
        choices: [
          { value: "sweep", label: "sweep" },
          { value: "nondet", label: "nondet" },
        ],
      },
      {
        name: "control",
        label: "Control",
        hint: "Closed: a controllable transition fires when enabled. Open: it waits for a go input.",
        choices: [
          { value: "closed", label: "closed" },
          { value: "open", label: "open" },
        ],
      },
    ],
  },
  {
    title: "Coloured tokens",
    about: "How a coloured place is laid out",
    options: [
      {
        name: "slots",
        label: "Slots",
        hint: "Positions for a coloured place without a capacity.",
      },
    ],
  },
];
