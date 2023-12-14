import { isPlainObject } from "lodash";

import {
  DynamicFieldsErrorsType,
  ExperimentTypes,
  FormDataType,
  FormErrorsType,
} from "./types";
import { ReactSelectOption } from "../../Dropdown/types";

export const flattenObjectKeysIntoString = (obj: any): any =>
  Object.keys(obj).flatMap((key) =>
    isPlainObject(obj[key])
      ? [key].concat(
          flattenObjectKeysIntoString(obj[key]).map(
            (innerKey: string) => `${key}.${innerKey}`,
          ),
        )
      : [key],
  );

export const getErrorClassname = (field?: boolean): string => {
  return field ? "ExperimentModal__ErroredField" : "";
};

export const convertToReactSelectOption = (
  value?: string,
): ReactSelectOption => ({
  label: value ?? "",
  value: value ?? "",
});

export const convertToReactSelectOptions = (value?: string) => {
  const splitted = value?.split(",");
  if (!splitted || splitted.length === 1) {
    return [convertToReactSelectOption(value)];
  }
  return splitted.map((text) => convertToReactSelectOption(text));
};

export const errorsTypeHasError = (errors: FormErrorsType): boolean => {
  if (errors.experimentTitle) {
    return true;
  }

  const objectContainsString = (obj: Object | undefined): boolean => {
    if (obj) {
      for (const value of Object.values(obj)) {
        if (typeof value === "object" && objectContainsString(value)) {
          return true;
        }

        if (typeof value === "string") {
          return true;
        }
      }
    }
    return false;
  };

  return objectContainsString(errors.dynamicFields);
};

export const formErrorsTypeFromDataType = (
  formData: FormDataType,
): FormErrorsType => {
  let experimentTitle = undefined;
  if (!formData.experimentTitle) {
    experimentTitle = "Experiment title is required";
  }
  const fields: DynamicFieldsErrorsType = {};
  if (ExperimentTypes.values === formData.experimentType.value) {
    const values = formData.dynamicFields[ExperimentTypes.values]!;
    fields[ExperimentTypes.values] = {
      steps:
        values.steps === undefined
          ? "Number of steps must be chosen"
          : undefined,
      field:
        values.field.value === undefined || values.field.value === ""
          ? "Field must be chosen"
          : undefined,
      values: values.values === undefined ? "Values must be chosen" : undefined,
    };
  }

  if (ExperimentTypes.linspace === formData.experimentType.value) {
    const values = formData.dynamicFields[ExperimentTypes.linspace]!;
    fields[ExperimentTypes.linspace] = {
      steps:
        values.steps === undefined
          ? "Number of steps must be chosen"
          : undefined,
      field:
        values.field.value === undefined || values.field.value === ""
          ? "Field must be chosen"
          : undefined,
      start:
        values.start === undefined ? "Start value must be chosen" : undefined,
      stop: values.stop === undefined ? "Stop value must be chosen" : undefined,
      samples:
        values.samples === undefined
          ? "Number samples of must be chosen"
          : undefined,
    };
  }

  if (ExperimentTypes.arange === formData.experimentType.value) {
    const values = formData.dynamicFields[ExperimentTypes.arange]!;
    fields[ExperimentTypes.arange] = {
      steps:
        values.steps === undefined
          ? "Number of steps must be chosen"
          : undefined,
      field:
        values.field.value === undefined || values.field.value === ""
          ? "Field must be chosen"
          : undefined,
      start:
        values.start === undefined ? "Start value must be chosen" : undefined,
      stop: values.stop === undefined ? "Stop value must be chosen" : undefined,
      increment:
        values.increment === undefined
          ? "Size of increment of must be chosen"
          : undefined,
    };
  }

  if (ExperimentTypes.monteCarlo === formData.experimentType.value) {
    const values = formData.dynamicFields[ExperimentTypes.monteCarlo]!;
    fields[ExperimentTypes.monteCarlo] = {
      steps:
        values.steps === undefined
          ? "Number of steps must be chosen"
          : undefined,
      field:
        values.field.value === undefined || values.field.value === ""
          ? "Field must be chosen"
          : undefined,
      samples:
        values.samples === undefined
          ? "Number samples of must be chosen"
          : undefined,
      distribution:
        values.distribution.value === undefined ||
        values.distribution.value === ""
          ? "Distribution must be chosen"
          : undefined,
    };
  }

  if (ExperimentTypes.group === formData.experimentType.value) {
    const values = formData.dynamicFields[ExperimentTypes.group]!;
    fields[ExperimentTypes.group] = {
      steps:
        values.steps === undefined
          ? "Number of steps must be chosen"
          : undefined,
    };
  }

  if (ExperimentTypes.multiparameter === formData.experimentType.value) {
    const values = formData.dynamicFields[ExperimentTypes.multiparameter]!;
    fields[ExperimentTypes.multiparameter] = {
      steps:
        values.steps === undefined
          ? "Number of steps must be chosen"
          : undefined,
    };
  }

  if (ExperimentTypes.optimization === formData.experimentType.value) {
    const values = formData.dynamicFields[ExperimentTypes.optimization]!;
    fields[ExperimentTypes.optimization] = {
      maxRuns:
        values.maxRuns === undefined
          ? "Maximum number of runs must be chosen"
          : undefined,
      minSteps:
        values.minSteps === undefined
          ? "Minimum number of steps must be chosen"
          : undefined,
      maxSteps:
        values.maxSteps === undefined
          ? "Maximum number of steps must be chosen"
          : undefined,
      metricName:
        values.metricName.value === ""
          ? "Metric name must be chosen"
          : undefined,
      metricObjective:
        values.metricObjective === undefined
          ? "Metric objective must be chosen"
          : undefined,
      fields: values.fields.map((optField) => ({
        name:
          optField.name === undefined
            ? "Optimization field name must be chosen"
            : undefined,
        value:
          optField.value === undefined || optField.value === ""
            ? "Optimization field value must be chosen"
            : undefined,
      })),
    };
  }

  return {
    experimentTitle,
    dynamicFields: fields,
  };
};
