import { DatasetFormat } from "@hashintel/utils/lib/datasets/fetchDataset";

import {
  AgentState,
  JsCustomBehaviors,
  JsInitializer,
  JsMessageHandlers,
  Json,
} from "../../glue";

// Simulations
export type SimulationComponents = {
  initializer: JsInitializer;
  properties: Json;
  datasets: Json;
  behaviors: JsCustomBehaviors;
  handlers: JsMessageHandlers;
};

export type RawManifest = {
  behaviors: {
    shortname: string;
    dependencies: string[] | null;
    behaviorSrc: string;
    id?: string;
  }[];
  initializers: {
    id: string;
    name: string;
    initSrc: string;
  }[];
  propertiesSrc: string;
  analysisSrc: string;
  experimentsSrc?: string;
  datasets: FetchedDataset[];
};

// Analysis
type FinalOp<A> = { position: "final"; op: A };
type MapOp<A> = { position: "map"; op: A; field: string };

export type Comparison = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";

export type Op =
  | FinalOp<"count">
  | FinalOp<"sum">
  | FinalOp<"min">
  | FinalOp<"max">
  | FinalOp<"mean">
  | (FinalOp<"movingAverage"> & { window: number })
  | MapOp<"get">
  | (MapOp<"filter"> & {
      comparison: Comparison;
      value: any | any[];
    });

// Datasets
export type FetchedDataset = {
  id: string;
  name: string | undefined;
  shortname: string;
  url: string; // This url updates every time you fetch it, and it expires.
  filename: string;
  extension: string;
  format: DatasetFormat | null;
  s3Key: string; // This is unique per dataset per version
  inPlaceData: string | null;
};
