import { OPTIONS, optionStates, parsePetriNetIr } from "../../compiler";
import { EXAMPLES } from "../../examples/catalog";
import { OPTION_SECTIONS, valueLabel } from "../options/option-labels";

import type { OptionName } from "../../compiler";
import type { Example } from "../../examples/catalog";
import type { OptionLabels } from "../options/option-labels";

/** By option, then by value, the titles of the examples that open with it. */
type Opened = Map<OptionName, Map<string, string[]>>;

/** The value each example opens with, by option, counting only the examples the option applies to. */
function openedValues(examples: readonly Example[]): Opened {
  const opened: Opened = new Map();
  for (const example of examples) {
    const parsed = parsePetriNetIr(example.ir);
    if (!parsed.ok) {
      continue;
    }
    for (const state of optionStates(parsed.ir, example.options)) {
      if (state.notApplicable !== undefined) {
        continue;
      }
      const byValue = opened.get(state.name) ?? new Map<string, string[]>();
      byValue.set(state.value, [...(byValue.get(state.value) ?? []), example.title]);
      opened.set(state.name, byValue);
    }
  }
  return opened;
}

/** What the examples open with: the most common value, then the others with the examples that take them. */
function openedWith(labels: OptionLabels, opened: Opened): string {
  const groups = [...(opened.get(labels.name) ?? new Map<string, string[]>())].toSorted(
    ([, a], [, b]) => b.length - a.length,
  );
  const [first, ...rest] = groups;
  if (first === undefined) {
    return "no example";
  }
  return [
    valueLabel(labels, first[0]),
    ...rest.map(([value, titles]) => `${valueLabel(labels, value)} for ${titles.join(", ")}`),
  ].join("; ");
}

/** The values in the panel's order; a number shows the compiler's default alone. */
function valuesOf(labels: OptionLabels): { value: string; label: string; isDefault: boolean }[] {
  const fallback = String(OPTIONS[labels.name].default);
  const choices = labels.choices ?? [{ value: fallback, label: fallback }];
  return choices.map(({ value, label }) => ({ value, label, isDefault: value === fallback }));
}

/**
 * Every option of the Compiler options panel, grouped as the panel groups
 * them: its values with the compiler's default marked, what it applies to,
 * and what the examples open with.
 */
export const StrategyTable: React.FC = () => {
  const opened = openedValues(EXAMPLES);
  return (
    <table className="strategy-table">
      <thead>
        <tr>
          <th scope="col">Option</th>
          <th scope="col">Values</th>
          <th scope="col">Applies to</th>
          <th scope="col">Examples open with</th>
        </tr>
      </thead>
      {OPTION_SECTIONS.map((section) => (
        <tbody key={section.title}>
          <tr>
            <th scope="colgroup" colSpan={4}>
              {section.title}
            </th>
          </tr>
          {section.options.map((labels) => (
            <tr key={labels.name}>
              <th scope="row">
                {labels.label}
                {labels.label.toLowerCase() === labels.name ? null : <> (<code>{labels.name}</code>)</>}
              </th>
              <td>
                {valuesOf(labels).map(({ value, label, isDefault }) => (
                  <code key={value} data-default={isDefault}>
                    {label}
                  </code>
                ))}
              </td>
              <td>{OPTIONS[labels.name].appliesTo}</td>
              <td>{openedWith(labels, opened)}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
};
