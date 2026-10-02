import { describe, expect, it } from "vitest";

import { OPTIONS, OPTION_NAMES } from "../../compiler";
import { OPTION_SECTIONS } from "./option-labels";

describe("OPTION_SECTIONS", () => {
  const labelled = OPTION_SECTIONS.flatMap((section) => section.options);

  it("shows every compiler option once", () => {
    // GIVEN the panel's sections
    // WHEN their options are listed
    // THEN each compiler option appears exactly once
    expect(labelled.map((labels) => labels.name).toSorted()).toEqual(OPTION_NAMES.toSorted());
  });

  it("labels exactly the compiler's values, and nests an option under one shown before it", () => {
    // GIVEN each option's labels
    for (const labels of labelled) {
      // THEN the labelled values are the compiler's, and a parent comes first
      const values = OPTIONS[labels.name].values;
      expect(labels.choices?.map((choice) => choice.value).toSorted() ?? null).toEqual(
        values === null ? null : [...values].toSorted(),
      );
      if (labels.under !== undefined) {
        expect(labelled.findIndex((other) => other.name === labels.under)).toBeLessThan(labelled.indexOf(labels));
      }
    }
  });
});
