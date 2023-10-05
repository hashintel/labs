import { createSelector } from "@reduxjs/toolkit";

import { FormDataType } from "../../../Modal/Experiments/types";
import { selectExperimentsSrc } from "../../../../features/files/selectors";

type ExperimentType = Record<string, { description?: string }> | FormDataType;

export const selectExperiments = createSelector(
  selectExperimentsSrc,
  (experimentsSrc) => {
    try {
      const experiments: ExperimentType = JSON.parse(experimentsSrc || "{}");
      return Object.entries(experiments);
    } catch (err) {
      console.error("Error parsing experiments.json", err);
      return null;
    }
  }
);
