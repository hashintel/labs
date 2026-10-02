import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "./parse";

import type { PetriNetIr } from "./schema";

describe("parsePetriNetIr", () => {
  it("reads colours, dynamics, code blocks, token lists and quoted keys", () => {
    // GIVEN a coloured net written as block YAML, with a key YAML 1.1 reads as a Boolean
    const text = [
      "name: boiler",
      "kind: plain",
      "",
      "colours:",
      "  Vessel:",
      "    level: real",
      "    state:",
      "      enum: [idle, hot]",
      "",
      "dynamics:",
      "  Heat:",
      "    colour: Vessel",
      "    code: |",
      "      return tokens.map((t) => ({ level: 0.5 * (10 - t.level) }));",
      "",
      "places:",
      "  Tank:",
      "    colour: Vessel",
      "    dynamics: Heat",
      "    capacity: 1",
      "  'On':",
      "",
      "marking:",
      "  Tank:",
      "    - {level: 0, state: idle}",
      "",
      "transitions:",
      "  Alarm:",
      "    inputs:",
      "      Tank:",
      "        kind: read",
      "    outputs:",
      "      'On':",
      "        weight: 2",
      "    guard: |",
      "      return input.Tank[0].level >= 8;",
      "",
    ].join("\n");
    // WHEN it is parsed
    const parsed = parsePetriNetIr(text);
    // THEN every section reads as the IR, code blocks keep their newline, and On is a name
    const expected: PetriNetIr = {
      name: "boiler",
      kind: "plain",
      colours: { Vessel: { level: "real", state: { enum: ["idle", "hot"] } } },
      dynamics: {
        Heat: {
          colour: "Vessel",
          code: "return tokens.map((t) => ({ level: 0.5 * (10 - t.level) }));\n",
        },
      },
      places: { Tank: { colour: "Vessel", dynamics: "Heat", capacity: 1 }, On: null },
      marking: { Tank: [{ level: 0, state: "idle" }] },
      transitions: {
        Alarm: {
          inputs: { Tank: { kind: "read" } },
          outputs: { On: { weight: 2 } },
          guard: "return input.Tank[0].level >= 8;\n",
        },
      },
    };
    expect(parsed).toEqual({ ok: true, ir: expected });
  });

  it("reports a YAML syntax error at its line", () => {
    // GIVEN a document whose last key is under-indented
    const text = "name: cycle\nkind: plain\nplaces:\n  A:\n B:\n";
    // WHEN it is parsed
    const parsed = parsePetriNetIr(text);
    // THEN one yaml-syntax error points at that line
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0]).toMatchObject({ code: "yaml-syntax", line: 5 });
      expect(parsed.errors[0]?.message).toContain("indentation");
    }
  });

  it("reports every schema issue at the line of its key, naming the item", () => {
    // GIVEN a document with a bad kind, a negative capacity, a lowercase name and a misspelt key
    const text = [
      "name: cycle",
      "kind: weird",
      "",
      "places:",
      "  A:",
      "    capacity: -1",
      "  lower:",
      "",
      "transitions:",
      "  Go:",
      "    input:",
      "      A:",
      "    rate: 2",
    ].join("\n");
    // WHEN it is parsed
    const parsed = parsePetriNetIr(text);
    // THEN each issue is one error at its key's line, naming the item it concerns
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.map((error) => [error.item.kind, error.item.name, error.line])).toEqual([
        ["net", "kind", 2],
        ["place", "A", 6],
        ["place", "lower", 7],
        ["transition", "Go", 10],
      ]);
      expect(parsed.errors.map((error) => error.message)).toEqual([
        expect.stringContaining("kind: "),
        expect.stringContaining("places.A.capacity: "),
        expect.stringContaining("UpperCamelCase"),
        expect.stringContaining('transitions.Go: Unrecognized key: "input"'),
      ]);
    }
  });

  it("reports a zeroth section as an unknown key: the options are passed beside the document", () => {
    // GIVEN a plain net that also writes compiler options
    const text = [
      "name: cycle",
      "kind: plain",
      "places:",
      "  A:",
      "transitions: {}",
      "zeroth:",
      "  shape: modular",
    ].join("\n");
    // WHEN it is parsed
    const parsed = parsePetriNetIr(text);
    // THEN the section is refused as a key the IR does not have
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.map((error) => [error.code, error.message])).toEqual([
        ["schema", 'Unrecognized key: "zeroth"'],
      ]);
    }
  });

  it("reports an empty document as a YAML error with no line", () => {
    // GIVEN no text, blank lines, and a comment alone
    const texts = ["", "  \n\n", "# only a comment\n"];
    // WHEN each is parsed
    const outcomes = texts.map((text) => parsePetriNetIr(text));
    // THEN each is one yaml-syntax error that points at no line
    for (const parsed of outcomes) {
      expect(parsed).toEqual({
        ok: false,
        errors: [
          {
            code: "yaml-syntax",
            message: "expected a document, but the input is empty",
            item: { kind: "net", name: "document" },
          },
        ],
      });
    }
  });
});
