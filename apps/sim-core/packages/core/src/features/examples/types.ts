import { PartialSimulationProject } from "../project/types";

export interface ExamplesSlice {
  ids: string[];
  entities: Record<string, PartialSimulationProject | undefined>;
  examplesLoaded: boolean;
}
