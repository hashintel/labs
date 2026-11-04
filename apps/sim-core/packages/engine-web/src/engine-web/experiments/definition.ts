import { v4 as uuid } from "uuid";

import { EvalError } from "../simulation/EvalError";
import {
  ExperimentDefinition,
  ExperimentDefinitionWithoutOptimization,
  ExperimentPlan,
  ParsedExperimentDefinitions,
  PlannedRunVariant,
} from "./types";
import { parseAndThrowProper } from "../simulation/simFromSrc";
import { sampleDistribution } from "./montecarlo";

export const createExperimentDefinition = (
  experimentsSrc: string,
  experimentName: string
): ExperimentDefinition => {
  const experimentDefinitions: ParsedExperimentDefinitions = parseAndThrowProper(
    experimentsSrc,
    "experiments.json"
  );

  return experimentDefinitions[experimentName];
};

export const createExperimentPlan = (
  experimentsSrc: string,
  experimentName: string
): [ExperimentPlan, ExperimentDefinitionWithoutOptimization] => {
  const experimentDefinitions: ParsedExperimentDefinitions = parseAndThrowProper(
    experimentsSrc,
    "experiments.json"
  );

  const selectedExperiment = experimentDefinitions[experimentName];

  if (selectedExperiment.type === "optimization") {
    throw new Error("Cannot run optimization experiment locally");
  }

  return [
    createExperimentVariants(experimentName, experimentDefinitions),
    selectedExperiment,
  ];
};

export const createExperimentVariants = (
  experimentName: string,
  experimentDefinitions: ParsedExperimentDefinitions
): ExperimentPlan => {
  // Select the experiment from the name that the user gave us
  const selectedExperiment = experimentDefinitions[experimentName];

  // Panic if there's no experiment definition with that name
  if (!selectedExperiment) {
    throw new Error(
      `No experiment with name '${experimentName}' found in experiments.json`
    );
  }
  switch (selectedExperiment.type) {
    case "group":
      return createGroupVariant(selectedExperiment, experimentDefinitions);
    case "multiparameter":
      return createMultiparameterVariant(
        selectedExperiment,
        experimentDefinitions
      );
    default:
      return createExperimentPlanFromArgs(selectedExperiment);
  }
};

const createExperimentPlanFromArgs = (
  selectedExperiment: ExperimentDefinition
) => {
  switch (selectedExperiment.type) {
    case "monte-carlo":
      return createMonteCarloVariant(selectedExperiment);

    case "values":
      return createValueVariant(selectedExperiment);

    case "linspace":
      return createLinspaceVariant(selectedExperiment);

    case "arange":
      return createArangeVariant(selectedExperiment);

    case "meshgrid":
      return createMeshgridVariant(selectedExperiment);

    default:
      throw new EvalError(
        "Not a valid experiment type, see docs.hash.ai/experiments on how to define an experiment run",
        "experiments.json"
      );
  }
};

const createVariantWithMappedValue = (
  field: string,
  items: any[],
  mapper: (item: any, idx: number) => any
) =>
  items.reduce<ExperimentPlan>((acc, val, idx) => {
    const mappedValue = mapper(val, idx);

    acc[uuid()] = {
      fields: {
        [field]: mappedValue,
      },
    };

    return acc;
  }, {});

/**
 * Similar to the Numpy arange function
 * https://numpy.org/doc/stable/reference/generated/numpy.arange.html
 */
const arange = (start: number, stop: number, step: number) => {
  const samples: number[] = [];

  for (let cur = start; cur <= stop; cur += step) {
    samples.push(cur);
  }

  return samples;
};

const linspace = (start: number, stop: number, numSamples: number) => {
  const samples: number[] = [];
  const length = (stop - start) / (numSamples - 1);
  for (let idx = start; idx <= stop; idx += length) {
    const val = start + length * idx;
    samples.push(val);
  }
  return samples;
};

const createValueVariant = (
  definition: ExperimentDefinition<"values">
): ExperimentPlan =>
  createVariantWithMappedValue(
    definition.field,
    definition.values,
    (val) => val
  );

const createLinspaceVariant = ({
  field,
  samples,
  start,
  stop,
}: ExperimentDefinition<"linspace">): ExperimentPlan =>
  createVariantWithMappedValue(
    field,
    Array(samples).fill(0),
    (_, idx) => start + (idx * (stop - start)) / (samples - 1)
  );

const createMeshgridVariant = ({
  xfield,
  yfield,
  steps,
  x,
  y,
}: ExperimentDefinition<"meshgrid">): ExperimentPlan => {
  const plan: ExperimentPlan = {};

  // Arguments are specified as start, stop, and numsamples
  // a linspace across a grid
  const xspace = linspace(...x);
  const yspace = linspace(...y);

  let idx = 0;
  for (const xVal of xspace) {
    for (const yVal of yspace) {
      plan[uuid()] = {
        fields: {
          [xfield]: xVal,
          [yfield]: yVal,
        },
      };
      idx += 1;
    }
  }

  return plan;
};

const createMultiparameterVariant = (
  definition: ExperimentDefinition<"multiparameter">,
  experimentDefinitions: ParsedExperimentDefinitions
): ExperimentPlan => {
  const parameterList = definition.runs.map((runName) => {
    const definition = experimentDefinitions[runName];
    return createExperimentPlanFromArgs(definition);
  });

  // We're going to reuse the plan, modifiying it in place, and add new values for each value in the plan
  // This lets incredibly high dimension runs
  let variantList: PlannedRunVariant[] = [];

  // Loop over every element in the variant list, creating new ones and merging with
  // the existing definition
  let idx = 0;
  for (const subplan of parameterList) {
    if (idx === 0) {
      variantList = Object.values(subplan).map((entry) => entry.fields);
    } else {
      // Create a new plan
      const newVariants: PlannedRunVariant[] = [];
      for (const entry of Object.values(subplan).map((entry) => entry.fields)) {
        for (const existingEntry of variantList) {
          newVariants.push({
            ...existingEntry,
            ...entry,
          });
        }
      }
      variantList = newVariants;
    }
    idx += 1;
  }

  // Use the list of variants and generate a final output
  const finalPlan: ExperimentPlan = {};
  let index = 0;
  for (const variant of variantList) {
    finalPlan[uuid()] = {
      fields: variant,
    };
    index += 1;
  }

  return finalPlan;
};

const createArangeVariant = ({
  start,
  stop,
  increment,
  field,
}: ExperimentDefinition<"arange">): ExperimentPlan =>
  createVariantWithMappedValue(
    field,
    arange(start, stop, increment),
    (val) => val
  );

const createGroupVariant = (
  definition: ExperimentDefinition<"group">,
  experimentDefinitions: ParsedExperimentDefinitions
) => {
  const plan = definition.runs.reduce<ExperimentPlan>(
    (acc, name) => ({
      ...acc,
      ...createExperimentVariants(name, experimentDefinitions),
    }),
    {}
  );

  return plan;
};

export const createMonteCarloVariant = (
  definition: ExperimentDefinition<"monte-carlo">
): ExperimentPlan =>
  createVariantWithMappedValue(
    definition.field,
    Array(definition.samples).fill(0),
    () => sampleDistribution(definition)
  );
