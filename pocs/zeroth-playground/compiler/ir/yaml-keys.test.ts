import { describe, expect, it } from "vitest";

import { yamlKeys } from "./yaml-keys";

describe("yamlKeys", () => {
  it("gives every key its path and the lines it spans, and skips block scalar bodies", () => {
    // GIVEN block YAML with a block scalar, blank lines between sections and a token list
    const text = [
      "name: boiler",
      "kind: plain",
      "",
      "dynamics:",
      "  Heat:",
      "    colour: Vessel",
      "    code: |",
      "      return tokens.map((t) => ({ level: 0.5 * (10 - t.level) }));",
      "",
      "places:",
      "  Tank:",
      "    capacity: 1",
      "  Alarms:",
      "",
      "marking:",
      "  Tank:",
      "    - {level: 0}",
    ].join("\n");
    // WHEN its keys are read
    const keys = yamlKeys(text);
    // THEN each key runs to its last line, less trailing blanks, and the code is not a key
    expect(keys.map(({ path, line, endLine }) => [path.join("."), line, endLine])).toEqual([
      ["name", 1, 1],
      ["kind", 2, 2],
      ["dynamics", 4, 8],
      ["dynamics.Heat", 5, 8],
      ["dynamics.Heat.colour", 6, 6],
      ["dynamics.Heat.code", 7, 8],
      ["places", 10, 13],
      ["places.Tank", 11, 12],
      ["places.Tank.capacity", 12, 12],
      ["places.Alarms", 13, 13],
      ["marking", 15, 17],
      ["marking.Tank", 16, 17],
    ]);
  });

  it("reads a quoted key by its name", () => {
    // GIVEN a place a dumper quotes, since YAML 1.1 reads On as a Boolean
    const text = "places:\n  'On':\n  \"Off\":\n";
    // WHEN its keys are read
    const keys = yamlKeys(text);
    // THEN the paths hold the bare names
    expect(keys.map((key) => key.path.join("."))).toEqual(["places", "places.On", "places.Off"]);
  });
});
