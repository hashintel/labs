import { set } from "lodash";
import { v4 as uuid } from "uuid";

import { EvalError, QueuedExperimentRunWithoutOptimization } from "../..";
import { ExperimentSrc, RunnerRequest } from "../runners";
import { RawManifest, parseAndThrowProper } from "..";
import { createExperimentPlan } from ".";

/**
 * Prepare a QueuedExperimentRun with a sorted array of simulationIds
 */
export const prepareExperiment = ({
  project,
  manifestSrc,
  experimentName,
  presetUuid,
}: ExperimentSrc): QueuedExperimentRunWithoutOptimization => {
  const manifest: RawManifest = parseAndThrowProper(
    manifestSrc,
    "manifest.json",
  );
  const { experimentsSrc } = manifest;

  if (!experimentsSrc) {
    throw new EvalError("No experiments defined", "experiments.json");
  }

  const [plannedRuns, selectedExperiment] = createExperimentPlan(
    experimentsSrc,
    experimentName,
  );

  if (!selectedExperiment.steps) {
    throw new EvalError(
      `Must specify 'steps' field for experiment '${experimentName}'`,
      "experiments.json",
    );
  }

  // Assemble a new queued run
  const simulationIds = Object.keys(plannedRuns);

  return {
    project,
    experimentId: presetUuid ?? uuid(),
    manifest,
    experimentName,
    simulationIds,
    status: "queued",
    queuedSimulationRunIds: new Set(simulationIds),
    definition: selectedExperiment,
    plan: plannedRuns,
    target: "web",
    startedTime: Date.now(),
  };
};

export const experimentToRuns = (
  {
    queuedSimulationRunIds,
    manifest,
    plan,
    definition,
  }: QueuedExperimentRunWithoutOptimization,
  pyodideEnabled: boolean,
): RunnerRequest<"initialize">[] => {
  const requests: RunnerRequest<"initialize">[] = [];
  console.log("queued run is ", queuedSimulationRunIds);

  for (const simulationRunId of queuedSimulationRunIds.values()) {
    console.log("creating new variant");
    // Make a new globals
    const globalsVariant = JSON.parse(manifest.propertiesSrc);
    for (const [key, value] of Object.entries(plan[simulationRunId].fields)) {
      set(globalsVariant, key, value);
    }

    // Make a new manifest with the globals
    const newManifest: RawManifest = {
      ...manifest,
      propertiesSrc: JSON.stringify(globalsVariant),
    };

    // Initialize and kick off the runner
    requests.push({
      type: "initialize",
      includeSteps: true,
      manifestSrc: JSON.stringify(newManifest),
      numSteps: definition.steps,
      presetRunId: simulationRunId,
      pyodideEnabled,
    });
  }
  return requests;
};
