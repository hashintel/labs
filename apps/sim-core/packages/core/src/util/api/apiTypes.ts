/**
 * Manually-defined API types replacing the generated auto-types.ts.
 * These match the GraphQL schema shapes used by the remaining queries.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum CommitActionVerb {
  Create = "create",
  Delete = "delete",
  Move = "move",
  Update = "update",
}

export enum ProjectTypeName {
  Simulation = "Simulation",
  Dataset = "Dataset",
  Behavior = "Behavior",
}

export enum VisibilityLevel {
  Public = "public",
  Private = "private",
}

export enum ProjectHistoryItemType {
  Release = "Release",
  CommitGroup = "CommitGroup",
  ExperimentRun = "ExperimentRun",
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export interface CommitStats {
  additions: number;
  deletions: number;
}

export interface Commit {
  id: string;
  message: string;
  stats: CommitStats;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Project History
// ---------------------------------------------------------------------------

export interface CommitGroup {
  commits: Array<Pick<Commit, "id" | "message" | "createdAt">>;
}

export interface ExperimentPackageData {
  metricName: string | null;
  metricObjective: string | null;
}

export interface SimulationRun {
  id: string;
  stepsLink: string | null;
  analysisLink: string | null;
  propertyValues: string | null;
  metricOutcome: number | null;
}

export interface ProjectHistoryItemItem {
  __typename: string;
  tag?: string;
  createdAt?: string;
  commits?: Array<Pick<Commit, "id" | "message" | "createdAt">>;
  id?: string;
  name?: string;
  experimentSrc?: string;
  packageData?: ExperimentPackageData | null;
  simulationRuns?: SimulationRun[];
}

export interface ProjectHistoryItem {
  itemType: ProjectHistoryItemType;
  item: ProjectHistoryItemItem;
  createdAt: string;
}

export interface ProjectHistoryReturn {
  items: ProjectHistoryItem[];
  next?: string | null;
  remaining: boolean;
  receivedCurrent: boolean;
}

export interface ProjectHistoryQueryVariables {
  pathWithNamespace: string;
  ref: string;
  pageToCurrent: boolean;
  accessCode?: string | null;
  createdBefore?: string | null;
}

export interface ProjectHistoryQuery {
  project: {
    history?: ProjectHistoryReturn | null;
  };
}

// ---------------------------------------------------------------------------
// Project (for embed mode / unpreparedProjectByPath)
// ---------------------------------------------------------------------------

export interface ProjectFile {
  name: string;
  path: string;
  contents: string;
  ref: string;
  dependencyPath?: string;
}

export interface ProjectByPathQueryVariables {
  pathWithNamespace: string;
  version: string;
  accessCode?: string | null;
}

export interface ProjectByPathQuery {
  project: {
    id: string;
    name: string;
    description: string;
    image: string | null;
    thumbnail: string | null;
    createdAt: string;
    updatedAt: string;
    canUserEdit: boolean;
    pathWithNamespace: string;
    namespace: string;
    type: string;
    ref: string;
    visibility: string;
    ownerType: string;
    keywords: string[];
    forkOf?: { pathWithNamespace: string } | null;
    latestRelease?: { tag: string; createdAt: string } | null;
    license?: { id: string; name: string } | null;
    files: ProjectFile[];
    dependencies: Array<{
      pathWithNamespace: string;
      tag: string;
      latestReleaseTag: string | null;
      canUserEdit: boolean;
      visibility: string;
      files: ProjectFile[];
    }>;
  };
}
