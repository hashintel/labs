import { describe, expect, it } from "vitest";

import { OPTIONS } from "../../compiler";
import { OPTION_LABELS } from "./option-labels";

describe("the presentation options", () => {
  it("label the compiler values for each choice", () => {
    // GIVEN the settings available in the presentation
    // THEN their choices are valid compiler values
    for (const labels of OPTION_LABELS) {
      expect(labels.choices?.map((choice) => choice.value).toSorted() ?? null).toEqual(
        OPTIONS[labels.name].values === null ? null : [...OPTIONS[labels.name].values!].toSorted(),
      );
    }
  });
});
