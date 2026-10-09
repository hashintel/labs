import { describe, expect, it } from "vitest";

import README from "./README.md?raw";
import { DIAGNOSTIC_CODES } from "./diagnostics";
import { OPTION_NAMES, OPTIONS } from "./options";

/** The body rows of every table in the README whose header row is `header`, as trimmed cells. */
function tableRows(header: string): string[][] {
  return README.split("\n\n")
    .map((block) => block.trim().split("\n"))
    .filter(([first]) => first === header)
    .flatMap((lines) =>
      lines.slice(2).map((line) =>
        line
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.trim()),
      ),
    );
}

function codeSpan(text: string | number): string {
  return `\`${text}\``;
}

describe("the README", () => {
  it("lists every option in the order of OPTIONS, with its values, what it applies to and what it decides", () => {
    // GIVEN the options table in the README
    const rows = tableRows("| Option | Values, default first | Applies to | Decides |");
    // THEN each row says what the option's entry in OPTIONS says
    expect(rows).toEqual(
      OPTION_NAMES.map((name) => {
        const { values, appliesTo, summary } = OPTIONS[name];
        const choices =
          values === null
            ? `${codeSpan(OPTIONS[name].default)}, or any positive number`
            : values.map(codeSpan).join(", ");
        return [codeSpan(name), choices, appliesTo, summary];
      }),
    );
  });

  it("lists every diagnostic code in the order of DIAGNOSTIC_CODES, with its meaning word for word", () => {
    // GIVEN the diagnostics tables in the README
    const rows = tableRows("| Code | Meaning |");
    // THEN together they hold one row per code, with the meaning DIAGNOSTIC_CODES gives it
    expect(rows).toEqual(
      Object.entries(DIAGNOSTIC_CODES).map(([code, meaning]) => [codeSpan(code), meaning]),
    );
  });
});
