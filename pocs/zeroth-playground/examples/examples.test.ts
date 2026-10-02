import { describe, expect, it } from "vitest";

import { compile } from "../compiler";
import { EXAMPLES } from "./catalog";

/** Each example compiled under the options it opens with, as the playground opens it. */
const OPENED = EXAMPLES.map((example) => ({
  example,
  compilation: compile(example.ir, { options: example.options }),
}));

describe("the examples", () => {
  it("each compile, or are refused as expected, under the options they open with", () => {
    // GIVEN every example compiled under the options it opens with
    // WHEN each outcome is read off its compilation
    const outcomes = Object.fromEntries(
      OPENED.map(({ example, compilation: { files, errors } }) => [
        example.id,
        files.length > 0 ? "compiles" : errors.map((error) => error.code).join(","),
      ]),
    );
    // THEN the plain and stochastic nets compile, and the net with code waits for a parser
    expect(outcomes).toEqual({
      cycle: "compiles",
      conflict: "compiles",
      capacity: "compiles",
      arcs: "compiles",
      "birth-death": "compiles",
      "birth-death-clocked": "compiles",
      "cafe-queue": "compiles",
      "conflict-clocked": "compiles",
      bucket: "code-not-parsed",
    });
  });

  it("each open with options that apply to their net", () => {
    // GIVEN every example compiled under the options it opens with
    // THEN no option is dropped, so the panel shows every one
    const dropped = OPENED.flatMap(({ example, compilation }) =>
      compilation.warnings.map((warning) => `${example.id}: ${warning.message}`),
    );
    expect(dropped).toEqual([]);
  });

  for (const { example, compilation } of OPENED) {
    for (const file of compilation.files) {
      it(`write ${example.id}'s ${file.path} as the playground opens it`, async () => {
        // GIVEN the example compiled under the options it opens with
        // THEN the Python matches the snapshot beside the other examples' files
        await expect(file.text).toMatchFileSnapshot(`./__snapshots__/${example.id}/${file.path}`);
      });
    }
  }
});
