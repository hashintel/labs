import type { OptionName } from "../../compiler";

export type OptionLabels = {
  name: OptionName;
  label: string;
  hint: string;
  choices?: readonly { value: string; label: string }[];
};

export const OPTION_LABELS: readonly OptionLabels[] = [
  {
    name: "shape",
    label: "Modules",
    hint: "Compile the whole step together, or split places and transitions into modules.",
    choices: [
      { value: "monolithic", label: "One module" },
      { value: "modular", label: "Separate modules" },
    ],
  },
  { name: "dt", label: "Time step", hint: "The length of each coin step, Δt." },
  {
    name: "conflicts",
    label: "Choice",
    hint: "Use transition order, or let external inputs choose which transitions may fire.",
    choices: [
      { value: "sweep", label: "In order" },
      { value: "nondet", label: "External inputs" },
    ],
  },
];
