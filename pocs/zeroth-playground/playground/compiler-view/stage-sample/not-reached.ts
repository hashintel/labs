import { plural } from "./rows";

import type { SampleInput, StageSample } from "../stage-sample";

/** Why a stage after the parse has nothing to show. */
export function notParsed(): StageSample {
  return { tone: "idle", headline: "Not reached: the text does not parse as an IR.", rows: [] };
}

/** Why a stage after the lowering has nothing to show. */
export function notLowered(input: SampleInput): StageSample {
  return input.compilation.ir === null
    ? notParsed()
    : {
        tone: "idle",
        headline: `Not reached: the lowering refused the net with ${plural(input.compilation.errors.length, "error")}.`,
        rows: [],
      };
}
