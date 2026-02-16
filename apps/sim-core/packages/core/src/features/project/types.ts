import { FileAction, HcDependencyFile, HcFile } from "../files/types";
import { HashCoreAccessGateKindWithProps } from "../../components/HashCore/AccessGate";
import { License } from "../../util/api/types";
import { PartialSimulationProjectFieldsTuple } from "./utils";
export type ProjectFile = {
  name: string;
  path: string;
  contents: string;
  ref: string;
};

export type ReleaseFile = ProjectFile & {
  dependencyPath: string;
};

export type Release = {
  pathWithNamespace: string;
  tag: string;
  latestReleaseTag: string;
  files: ReleaseFile[];
  canUserEdit: boolean;
  visibility: ProjectVisibility;
};

type SimulationProjectType = "Simulation" | "Dataset" | "Behavior";

export type ReleaseDescription = {
  tag: string;
  createdAt: string;
};

export type SimulationProjectConfig = {
  files: string[];
  type: SimulationProjectType;
  keywords: string[];
  avatar?: string;
};

export type ProjectVisibility = "public" | "private";

export type CanUserEditProject = {
  canUserEdit: boolean;
  dependencies: Pick<Release, "pathWithNamespace" | "canUserEdit">[];
};

/**
 * @todo rename this to Project
 */
export type SimulationProject = {
  id: string;
  name: string;
  description?: string | null;
  image?: string | null;
  thumbnail?: string | null;
  createdAt: string;
  updatedAt: string;
  pathWithNamespace: string;
  namespace: string;
  type: SimulationProjectType;
  forkOf?: { pathWithNamespace: string } | null;
  ref: string;
  /**
   * @todo look into uses of this for opportunities to use scopes
   */
  latestRelease?: ReleaseDescription | null;
  config: SimulationProjectConfig;
  visibility: ProjectVisibility;
  license?: Pick<License, "id" | "name"> | null;
  keywords: string[];
  ownerType: "User" | "Org";
} & Omit<CanUserEditProject, "dependencies">;

export type RemoteSimulationProject = Omit<
  SimulationProject,
  "config" | "ref"
> & {
  files: ProjectFile[];
  dependencies?: Release[];
  ref?: string | null;
};

export type SimulationProjectWithHcFiles = SimulationProject & {
  files: HcFile[];
};

export type LocalStorageProject = SimulationProjectWithHcFiles & {
  actions: FileAction[];
};

export type ResourceProjectType = Exclude<SimulationProjectType, "Simulation">;
export type ResourceProject = Omit<
  SimulationProject,
  "config" | "forkOf" | "files" | "type" | "ref"
> & {
  type: ResourceProjectType;
  files: HcDependencyFile[];
  owner: {
    name: string;
  };
  trusted: boolean;
  subject: { name: string }[];
};

export type ProjectSlice = {
  projectLoaded: boolean;
  accessGate: (HashCoreAccessGateKindWithProps & { url: string | null }) | null;
  currentProject: SimulationProject | null;
  pendingProject: LinkableProject | null;
};

export type PartialSimulationProjectFields = PartialSimulationProjectFieldsTuple[number];

export type PartialSimulationProject = Pick<
  SimulationProject,
  PartialSimulationProjectFields
>;

export type UnpreparedPartialSimulationProject = Omit<
  PartialSimulationProject,
  "ref"
> & { latestRelease?: ReleaseDescription | null };

export type LinkableProject = Pick<SimulationProject, "pathWithNamespace"> & {
  ref?: SimulationProject["ref"] | null;
};

export type TourShowcase = PartialSimulationProject & {
  avatar?: string;
  thumbnail?: string;
  name: string;
};

export type ProjectUpdate =
  | { license?: string }
  | { keywords?: string[] }
  | { name?: string }
  | { description?: string }
  | { files?: { filename: string; path: string }[] };
