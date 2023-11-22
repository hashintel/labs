import {
  AgentState,
  JsCustomBehaviors,
  JsInitializer,
  JsMessageHandlers,
  Json,
  MessageHandler,
} from "../../";
import { DatasetCache } from "./dataset";
import {
  EvalError,
  SimulationComponents,
  fetchDatasetContent,
  getBehaviorFn,
  getInitFn,
} from ".";
import { NamedBehavior } from "../../glue";
import { RawManifest } from "./types";
import { builtInMessageHandlers } from "./messagehandler";

/**
 * Takes the "initialize" request and creates the new simulation components from
 * it
 */
export async function simulationFromRequest(
  manifestSrc: string,
  datasetCache: DatasetCache,
  pyodideEnabled: boolean,
): Promise<SimulationComponents> {
  const manifest: RawManifest = parseAndThrowProper(
    manifestSrc,
    "manifest.json",
  );

  const properties: Json = parseAndThrowProper(
    manifest.propertiesSrc,
    "globals.json",
  );

  const datasets = await fetchDatasetContent(manifest.datasets, datasetCache);

  const handlers: MessageHandler[] = builtInMessageHandlers;

  if (manifest.initializers.length !== 1) {
    throw new Error(
      `Only one initializer is supported, but the following were supplied: ${manifest.initializers}`,
    );
  }
  const initFile = manifest.initializers.pop()!;
  const initFn = await getInitFn(initFile.name, initFile.initSrc);

  const behaviors: NamedBehavior[] = [];
  for (const behavior of manifest.behaviors) {
    if (behavior.shortname.endsWith(".py") && !pyodideEnabled) {
      throw new Error("Cannot load pyodide");
    }

    // We do this non-functionally to only ever get one BehaviorFn at a time
    behaviors.push({
      behavior: await getBehaviorFn(behavior.shortname, behavior.behaviorSrc),
      dependencies: behavior.dependencies ?? [],
      name: behavior.shortname,
    });
  }

  return {
    properties: properties,
    initializer: new JsInitializer(initFile.name, initFn, properties, datasets),
    datasets: datasets,
    behaviors: new JsCustomBehaviors(behaviors, properties, datasets),
    handlers: new JsMessageHandlers(handlers),
  };
}

/**
 * A small utility to parse a json and then throw an EvalError with a specific
 * context
 */
export function parseAndThrowProper<T>(item: any, context: string): T {
  try {
    return item !== "" ? JSON.parse(item) : {};
  } catch (e) {
    throw new EvalError(e, context);
  }
}
