export interface Org {
  id: string;
  name: string;
  shortname: string;
}
interface Role {
  id: string;
  name: string;
  description?: string | null;
}
interface OrgInfo {
  org: Org;
  role: Role;
  jobTitle?: string | null;
}
export interface TourProgress {
  completed: boolean;
  version?: string | null;
  lastStepViewed?: string | null;
}

export interface BasicUser {
  id: string;
  email: string;
  fullName: string;
  shortname: string;
  staffMember?: boolean | null;
}

export type User = BasicUser & {
  memberOf?: OrgInfo[] | null;
  role: Role;
  cloudCredits?: number | null;
  image?: string | null;
};

export interface HasId {
  id: string;
}
export interface HasName {
  name: string;
}
export interface HasDescription {
  description: string;
}

export type Keyword = HasName & {
  count: string;
};

export type License = HasId &
  HasName &
  HasDescription & {
    url: string;
    default: boolean;
  };

export type Subject = HasId &
  HasName &
  HasDescription & {
    parent?: Subject;
    ancestors?: Subject[];
    parentChain?: string;
    layer?: "core" | "pending"; // SchemaOrgLayer
  };

export interface ReleaseMeta {
  keywords: Keyword[];
  licenses: License[];
  subjects?: Subject[];
}

export interface ApiCommitAction {
  action: CommitActionVerb;
  filePath: string;
  previousPath?: string;
  content?: string;
}

// Imported from the previously-but-no-longer generated file types.ts:

type Maybe<T> = T | null | undefined;
type Exact<T extends Record<string, unknown>> = { [K in keyof T]: T[K] };
/** All built-in and custom scalars, mapped to their actual values */
interface Scalars {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  JSONObject: any;
  Date: any;
  JSON: any;
  Upload: any;
}

interface ExperimentRun {
  id: Scalars["ID"];
  /** A friendly name for the ExperimentRun */
  name: Scalars["String"];
  /** The project the experiment is related to. */
  project: Project;
  /** The full path to the project this experiment is related to */
  projectPath: Scalars["String"];
  /** The name of the experiment package to run */
  packageName: ExperimentPackageName;
  /** Contextual data needed by the experiment package, if any */
  packageData?: Maybe<ExperimentPackageData>;
  /** Information on which simulation packages to run in this experiment */
  simPackages?: Maybe<SimulationPackageData[]>;
  /** The specific commit this experiment was started from */
  commit: Scalars["String"];
  /** The individual runs within the experiment. */
  simulationRuns: SimulationRun[];
  /** The contents of experiment.json used to generate the experiment. */
  experimentSrc?: Maybe<Scalars["JSONObject"]>;
  /** The source files needed to run the simulation, including dependencies */
  simulationFiles: ProjectFile[];
  /**
   * [DEPRECATED - use packageData.changedProperties] All the different property
   * configurations used to generate the individual runs
   */
  changedProperties?: Maybe<Scalars["JSONObject"][]>;
  /**
   * [DEPRECATED - see simulationFiles instead] If the simulation depends on any
   * shared behaviors, they will be provided here in createExperimentRun returns
   */
  sharedBehaviors?: Maybe<Maybe<ProjectFile[]>[]>;
  /**
   * [DEPRECATED - see simulationFiles instead] If the simulation depends on any
   * shared datasets, they will be provided here in createExperimentRun returns
   */
  sharedDatasets?: Maybe<Maybe<ProjectFile[]>[]>;
  /** When the ExperimentRun was initiated. */
  createdAt: Scalars["Date"];
  /** When the ExperimentRun was last updated (e.g. with compute usage). */
  updatedAt: Scalars["Date"];
  /** When the experiment's cloud compute usage was finalised (usually when the experiment ended) */
  usageFinalisedAt?: Maybe<Scalars["Date"]>;
  /** The user that initiated the experiment */
  user?: Maybe<User>;
  /** How much cloud compute time the experiment used (in seconds) */
  computeUsage: Scalars["Int"];
}

/** A collection of files that might be a simulation, dataset(s), or behavior(s) */
interface Project {
  /** The MongoDB ObjectId of the project */
  _id: Scalars["ID"];
  /** The ID of the project */
  id: Scalars["ID"];
  /** A friendly name for the project */
  name: Scalars["String"];
  /** The slug of the project */
  path: Scalars["String"];
  /** The namespace the resource belongs to, which represents either a user or an organization */
  namespace: Scalars["String"];
  /** The user or organisation which owns the resource */
  owner?: Maybe<UserOrOrg>;
  /** Whether the owner is a user or an org */
  ownerType: OwnerTypeName;
  /** The full path of the resource, including its namespace and path/name, in the format @namespace/path */
  pathWithNamespace: Scalars["String"];
  /** The level of access restriction on the resource */
  visibility: VisibilityLevel;
  /** A status given to some projects */
  trusted?: Maybe<Scalars["Boolean"]>;
  /** The total size of the project, in bytes */
  size?: Maybe<Scalars["Int"]>;
  /** A short description of the project */
  description?: Maybe<Scalars["String"]>;
  /** A mirror of README.md from the project repository */
  readme?: Maybe<Scalars["String"]>;
  /** The type of data model the project relates to */
  type: ProjectTypeName;
  /** Whether or not the project is archived (read-only and hidden from search results) */
  archived: Scalars["Boolean"];
  /** The file contents of the project */
  files: ProjectFile[];
  /** Experiments run on the project by the user or fellow organisation members */
  experiments?: Maybe<ExperimentRun[]>;
  history?: Maybe<ProjectHistoryReturn>;
  /** The branch or tag at which this project was requested (if any) */
  ref?: Maybe<Scalars["String"]>;
  /** A URL to an image or video representing the project */
  avatar?: Maybe<Scalars["String"]>;
  /** Issues raised against a project */
  issues: Issue[];
  contributors: ContributorInfo[];
  /** The number of open issues on a project */
  issueCount: Scalars["Int"];
  /** Merge requests open against a project */
  mergeRequests: MergeRequest[];
  /** The number of open merge requests on a project */
  mergeRequestCount: Scalars["Int"];
  /** Where the project avatar is a video, this is an URL to an image frame from the video to act as a thumbnail or fallback */
  thumbnail?: Maybe<Scalars["String"]>;
  /** A URL to a wide-ratio (1.91:1) cover image to promote and illustrate projects */
  image?: Maybe<Scalars["String"]>;
  /** Keywords / tags to help users locate the project */
  keywords: Scalars["String"][];
  /** The license the work is made available under */
  license?: Maybe<License>;
  /** The subject(s) of the project */
  subject: Subject[];
  /**
   * The percentage of behaviors in the project written in each programming
   * language (only available in Simulation or Behavior projects with releases -
   * calculation applies to the latest release)
   */
  languageSplit?: Maybe<LanguageSplit[]>;
  /** For behavior releases only, the languages of the released behaviors */
  languages?: Maybe<BehaviorLanguage[]>;
  /** The original source of the project (for dataset projects) */
  source?: Maybe<Scalars["String"]>;
  /** An external webpage for the dataset or dataset series */
  landingPage?: Maybe<Scalars["String"]>;
  /** The period of time the project covers */
  temporalCoverage?: Maybe<Scalars["String"]>;
  /** The frequency interval of the datapoints within the project (for datasets) */
  dataFrequency?: Maybe<Scalars["String"]>;
  /** The physical area covered by the project */
  spatialCoverage?: Maybe<Scalars["String"]>;
  /** The number of times a project has been forked */
  forkCount: Scalars["Int"];
  /** The number of times a project has been starred */
  starCount: Scalars["Int"];
  /** What project, if any, this project is a fork of */
  forkOf?: Maybe<ForkOfProject>;
  /** The paths of forks of the project the requesting user organization has */
  orgForkPaths?: Maybe<Scalars["String"][]>;
  /** The paths of forks of the project the requesting user has */
  userForkPaths?: Maybe<Scalars["String"][]>;
  /** The number of forks of the project the requesting user has */
  userForkCount?: Maybe<Scalars["Int"]>;
  /** The dependencies listed in a project */
  dependencies: Release[];
  /** The number of simulations that depend on an item within the listing */
  dependents?: Maybe<Scalars["Int"]>;
  /** A weighted score of the listing's relevance to a search query */
  relevance?: Maybe<Scalars["Float"]>;
  /** A score assigned to the popularity of the project */
  popularity: Scalars["Int"];
  /** The latest release of the project (if any) */
  latestRelease?: Maybe<ReleaseBasic>;
  /** All releases of a project */
  releases: ReleaseBasic[];
  /** A temporary URL from which the project can be downloaded as a zip file */
  downloadUrl?: Maybe<Scalars["String"]>;
  /** The date the project was originally created */
  createdAt: Scalars["Date"];
  /** The date the project was last updated */
  updatedAt: Scalars["Date"];
  /**
   * Whether or not the logged-in user can edit the project. To do so, one of the following must be true:
   *
   * 1) The user is a site admin OR
   * 2) The project owner is the user OR
   * 3) The project owner is an organization to which the user belongs
   */
  canUserEdit: Scalars["Boolean"];
  /**
   * Whether or not the logged-in user can fork the project. Projects cannot be
   * forked into the namespace they already exist in.
   */
  canUserFork: Scalars["Boolean"];
}

type UserOrOrg = User | Org;

/** The names of possible types of items a project */
export enum ProjectTypeName {
  Simulation = "Simulation",
  Dataset = "Dataset",
  Behavior = "Behavior",
}
/** The type of entity that owns the project */
enum OwnerTypeName {
  User = "User",
  Org = "Org",
}

/** The level of access restriction on the project */
export enum VisibilityLevel {
  /** Projects can be accessed by anyone */
  Public = "public",
  /** Projects can only be accessed by users who have been granted access (either directly or via group membership) */
  Private = "private",
}

/** A file in a project repository */
interface ProjectFile {
  /** A unique identifier within the repo */
  id: Scalars["ID"];
  /** The filename */
  name: Scalars["String"];
  /** The full path to the file within the repository */
  path: Scalars["String"];
  /**
   * The path the user refers to this by in their simulation logic.
   * If this is an imported dependency, its full path.
   * e.g. in the format @[namespace]/[slug]/[filename.ext]
   * For legacy behavior requests, this will be @[namespace]/[filename.ext]
   * For local datasets/behaviors, the filename.
   */
  dependencyPath: Scalars["String"];
  /** The contents of the file */
  contents: Scalars["String"];
  /** The size of the file in bytes */
  size: Scalars["Int"];
  /** The id of the last commit that affected the file */
  lastCommit: Scalars["String"];
  /** The id of the commit this file is from */
  commit: Scalars["String"];
  /** The branch or tag this version of the file is from */
  ref: Scalars["String"];
  /** "The type of file. Only currently implemented for Dataset */
  type?: Maybe<ProjectFileType>;
  /** The discovered subject of the dataset */
  discoveredSubject?: Maybe<Subject>;
}

enum ProjectFileType {
  Dataset = "Dataset",
  Behavior = "Behavior",
}

export interface ProjectHistoryReturn {
  items: ProjectHistoryItem[];
  next?: Maybe<Scalars["Date"]>;
  remaining: Scalars["Boolean"];
  receivedCurrent: Scalars["Boolean"];
}

interface ProjectHistoryItem {
  itemType: ProjectHistoryItemType;
  item: ProjectHistoryItemItem;
  createdAt: Scalars["Date"];
}

export enum ProjectHistoryItemType {
  Release = "Release",
  CommitGroup = "CommitGroup",
  ExperimentRun = "ExperimentRun",
}

type ProjectHistoryItemItem = ReleaseBasic | CommitGroup | ExperimentRun;

/** Basic information about a release */
interface ReleaseBasic {
  /** The version number */
  tag: Scalars["String"];
  /** The date of the release */
  createdAt: Scalars["Date"];
  /** A note accompanying the release (e.g. changes since last version) */
  description?: Maybe<Scalars["String"]>;
  /** The files exported from the release (or a subset of them if requested) */
  files: ProjectFile[];
}

export interface CommitGroup {
  commits: Commit[];
}

export interface Commit {
  /** A unique id for the commit */
  id: Scalars["ID"];
  /** The commit message */
  message: Scalars["String"];
  /** Statistics on additions and deletions from the commit */
  stats: CommitStats;
  /** The time at which the commit was created */
  createdAt: Scalars["Date"];
}

interface CommitStats {
  /** Lines added */
  additions: Scalars["Int"];
  /** Lines deleted */
  deletions: Scalars["Int"];
  /** Total actions */
  total: Scalars["Int"];
}

enum IssueLabel {
  Bug = "bug",
  Comment = "comment",
  Request = "request",
  Question = "question",
}

enum IssueState {
  Opened = "opened",
  Closed = "closed",
}

/** An issue raised on a project */
interface Issue {
  /** The unique identifier of the issue globally */
  id: Scalars["Int"];
  /** The unique identifier of the issue within the project */
  iid: Scalars["Int"];
  /** The title of the issue */
  title: Scalars["String"];
  author?: Maybe<User>;
  /** A description of the issue */
  description: Scalars["String"];
  /** Label(s) representing the issue's type(s) */
  labels: IssueLabel[];
  /** Whether the issue is open or closed */
  state: IssueState;
  /** Awards (emoji) the issue has received */
  awards: Award[];
  /** Discussion threads on the issue */
  discussions: Discussion[];
  /** Number of comments on the issue */
  notesCount: Scalars["Int"];
  createdAt: Scalars["Date"];
  updatedAt: Scalars["Date"];
  closedAt?: Maybe<Scalars["Date"]>;
  closedBy?: Maybe<Scalars["String"]>;
}

interface Award {
  id: Scalars["Int"];
  /** The name of the award emoji (e.g. "thumbs-up") */
  name: EmojiName;
  /** The shortname of the awarding user */
  author: Scalars["String"];
}

enum EmojiName {
  Thumbsup = "thumbsup",
  Thumbsdown = "thumbsdown",
}

/** A discussion thread on an issue or merge request */
interface Discussion {
  /** The unique identifier of the discussion globally */
  id: Scalars["String"];
  /** Notes (comments) in the discussion thread */
  notes: Note[];
}

interface Note {
  author?: Maybe<User>;
  /** Emojis awarded to the note */
  awards: Award[];
  /** The text content of the note */
  body: Scalars["String"];
  /** When the note was originally created */
  createdAt: Scalars["Date"];
  /** A globally unique id for the note */
  id: Scalars["Int"];
  /** The unique identifier of the noteable item within the project (iid) */
  noteableIid: Scalars["Int"];
  /** The type of noteable item */
  noteableType: NoteableTypeName;
  /** Whether or not it is possible to resolve/unresolve a note (Merge Requests only) */
  resolvable: Scalars["Boolean"];
  /** For resolvable notes, whether or not it is currently resolved */
  resolved?: Maybe<Scalars["Boolean"]>;
  /** The shortname of the user who resolved the note */
  resolvedBy?: Maybe<Scalars["String"]>;
  /** If the note is system-generated rather than user text content */
  system: Scalars["Boolean"];
  /** The last time the note was updated */
  updatedAt: Scalars["Date"];
}

enum NoteableTypeName {
  Issue = "Issue",
  MergeRequest = "MergeRequest",
}

interface ContributorInfo {
  id: Scalars["ID"];
  shortname: Scalars["String"];
  image: Scalars["String"];
  contributions: ContributionData;
}

interface ContributionData {
  commits: Scalars["Int"];
}

enum MergeRequestState {
  Opened = "opened",
  Closed = "closed",
  Locked = "locked",
  Merged = "merged",
}

/** A request to merge changes into a project branch */
interface MergeRequest {
  /** The unique identifier of the merge request globally */
  id: Scalars["Int"];
  /** The unique identifier of the merge request within the project */
  iid: Scalars["Int"];
  /** The path of the project the merge request originated from, in the format @namespace/path */
  sourcePath: Scalars["String"];
  /** The path of the project the merge request is opened against, in the format @namespace/path */
  projectPath: Scalars["String"];
  /** The title of the merge request */
  title: Scalars["String"];
  author?: Maybe<User>;
  /** A description of the merge request */
  description: Scalars["String"];
  /** Label(s) representing the merge request's type(s) */
  labels?: Maybe<MergeRequestLabel[]>;
  /** The list of files changed as part of the merge request */
  changes: FileChange[];
  /** Conflicts between the source and target branch, if any */
  conflicts?: Maybe<MergeRequestConflict[]>;
  /** Whether the merge request is open, closed, or merged */
  state: MergeRequestState;
  /** Whether or not the merge request may be merged */
  mergeable: Scalars["Boolean"];
  /** Whether or not the merge request has conflicts */
  hasConflicts: Scalars["Boolean"];
  /** Whether or not the merge request is marked as draft  */
  workInProgress: Scalars["Boolean"];
  /** Awards (emoji) the merge request has received */
  awards: Award[];
  /** Discussion threads on the merge request */
  discussions: Discussion[];
  /** Number of comments on the merge request */
  notesCount: Scalars["Int"];
  createdAt: Scalars["Date"];
  updatedAt: Scalars["Date"];
  closedAt?: Maybe<Scalars["Date"]>;
  closedBy?: Maybe<Scalars["String"]>;
  mergedAt?: Maybe<Scalars["Date"]>;
  mergedBy?: Maybe<Scalars["String"]>;
}

enum MergeRequestLabel {
  Bugfix = "bugfix",
  Feature = "feature",
  Enhancement = "enhancement",
}

interface FileChange {
  deletedFile?: Maybe<Scalars["String"]>;
  diff: Scalars["String"];
  newFile?: Maybe<Scalars["String"]>;
  newPath?: Maybe<Scalars["String"]>;
  oldPath?: Maybe<Scalars["String"]>;
  aMode?: Maybe<Scalars["String"]>;
  bMode?: Maybe<Scalars["String"]>;
  renamedFile?: Maybe<Scalars["String"]>;
}

interface MergeRequestConflict {
  filePath: Scalars["String"];
  diff: Scalars["String"];
}

/** The languages in use in the project as of the latest release */
interface LanguageSplit {
  language: BehaviorLanguage;
  percentage: Scalars["Float"];
}

enum BehaviorLanguage {
  JavaScript = "JavaScript",
  Python = "Python",
  Rust = "Rust",
}

interface ForkOfProject {
  /** Project slug */
  path: Scalars["String"];
  /** The namespace the project belongs to */
  namespace: Scalars["String"];
  /** The full path of the project, including its namespace and path, in the format @namespace/path */
  pathWithNamespace: Scalars["String"];
}

/** A release of specific files from a project, with a version tag */
interface Release {
  /** An id for the project */
  id: Scalars["String"];
  /** A friendly name for the project */
  name: Scalars["String"];
  /** The slug/shortname of the project */
  path: Scalars["String"];
  /** The visibility of the project */
  visibility: VisibilityLevel;
  /** The namespace the project belongs to, which represents either a user or an organization */
  namespace: Scalars["String"];
  /** The type of project this release relates to */
  type: ProjectTypeName;
  /** The full path of the project, including its namespace and path, in the format @namespace/path */
  pathWithNamespace: Scalars["String"];
  /** A description of the release */
  description?: Maybe<Scalars["String"]>;
  /** The specific release tag/version these files relate to */
  tag: Scalars["String"];
  /** The date this version was released */
  createdAt: Scalars["Date"];
  /** The files exported from the release (or a subset of them if requested) */
  files: ProjectFile[];
  /** Provides the tag from the most recent release */
  latestReleaseTag: Scalars["String"];
  /** The date of the latest release */
  latestCreatedAt: Scalars["String"];
  /**
   * Whether or not the logged-in user can edit the release's source project. To do so, one of the following must be true:
   *
   * 1) The user is a site admin OR
   * 2) The project owner is the user OR
   * 3) The project owner is an organization to which the user belongs
   */
  canUserEdit: Scalars["Boolean"];
}

enum ExperimentPackageName {
  Simple = "simple",
  Single = "single",
  Optimization = "optimization",
}

interface ExperimentPackageData {
  /** The properties changed in an experiment (if known on creation) */
  changedProperties?: Maybe<Scalars["JSONObject"][]>;
  /** For optimization experiments, the metric to optimize for */
  metricName?: Maybe<Scalars["String"]>;
  /** For optimization experiments, the objective for the metric */
  metricObjective?: Maybe<MetricObjective>;
  /** The maximum number of runs to try in an experiment */
  maxRuns?: Maybe<Scalars["Int"]>;
  /** The maximum number of steps a run should go for */
  maxSteps?: Maybe<Scalars["Int"]>;
  /** The minimum number of steps a run should go for before being terminated */
  minSteps?: Maybe<Scalars["Int"]>;
  /** For optimization experiments, combinations of parameter values to use for the first runs. */
  initialPoints?: Maybe<Scalars["JSONObject"][]>;
  /** For optimization experiments, the fields to explore as hyperparameters */
  fields?: Maybe<OptimizationField[]>;
}

enum MetricObjective {
  Max = "max",
  Min = "min",
}

interface OptimizationField {
  name: Scalars["String"];
  /** A range of values to explore */
  range?: Maybe<Scalars["String"]>;
  /** Discrete values to explore */
  values?: Maybe<Maybe<Scalars["JSON"]>[]>;
  /** A distribution of values to explore */
  distribution?: Maybe<DistributionName>;
  /** For normal distribution */
  mean?: Maybe<Scalars["Int"]>;
  /** For normal distribution */
  std?: Maybe<Scalars["Int"]>;
  /** For beta distribution */
  alpha?: Maybe<Scalars["Int"]>;
  /** For beta distribution */
  beta?: Maybe<Scalars["Int"]>;
  /** For logNormal distribution */
  mu?: Maybe<Scalars["Int"]>;
  /** For logNormal distribution */
  sigma?: Maybe<Scalars["Int"]>;
  /** For poisson distribution */
  rate?: Maybe<Scalars["Int"]>;
  /** For gamma distribution */
  shape?: Maybe<Scalars["Int"]>;
  /** For gamma distribution */
  scale?: Maybe<Scalars["Int"]>;
}

enum DistributionName {
  Normal = "normal",
  LogNormal = "logNormal",
  Poisson = "poisson",
  Beta = "beta",
  Gamma = "gamma",
}

interface SimulationPackageData {
  name: Scalars["String"];
  data?: Maybe<Scalars["String"]>;
}

interface SimulationRun {
  id: Scalars["ID"];
  /**
   * The specific property values different in this SimulationRun compared to the
   * others in the ExperimentRun. Will be null if this was a single-run experiment.
   */
  propertyValues?: Maybe<Scalars["JSONObject"]>;
  /** [DEPRECATED] - obsolete null value */
  propertiesSrc?: Maybe<Scalars["String"]>;
  /** An optional name to help identify the SimulationRun */
  name?: Maybe<Scalars["String"]>;
  /** For optimization experiments, the value of the metric of interest at the end of this run */
  metricOutcome?: Maybe<Scalars["Float"]>;
  /** The folder in s3 this run's output is stored in, in the hash-experiments bucket */
  s3Key: Scalars["String"];
  /** the ExperimentRun this is a part of */
  experimentRun: ExperimentRun;
  /** The path to the project this run is associated with */
  projectPath: Scalars["String"];
  /** The commit this run's source code can be found at */
  commit: Scalars["String"];
  /** [DEPRECATED - use ExperimentRun.simulationFiles] The source code used to generate this run */
  files?: Maybe<ProjectFile[]>;
  /** URL to retrieve the JSON files containing steps data */
  stepsLink?: Maybe<Scalars["String"]>;
  /** URL to retrieve the JSON files containing analysis data */
  analysisLink?: Maybe<Scalars["String"]>;
  /** When the SimulationRun was initiated. */
  createdAt: Scalars["Date"];
  /** When the SimulationRun was last updated (e.g. to be renamed) */
  updatedAt?: Maybe<Scalars["Date"]>;
}

/** An action operating on a single file as part of a commit */
interface CommitAction {
  /** The type of action to take */
  action: CommitActionVerb;
  /** The path of the file to operate on (or the new path, if being moved) */
  filePath: Scalars["String"];
  /** If a file is being moved, its previous path in the repository */
  previousPath?: Maybe<Scalars["String"]>;
  /** If a file is being created or updated, its content */
  content?: Maybe<Scalars["String"]>;
}

/** The types of action allowed on a file as part of a commit */
export enum CommitActionVerb {
  Create = "create",
  Delete = "delete",
  Move = "move",
  Update = "update",
}

export type CanUserEditProjectQueryVariables = Exact<{
  pathWithNamespace: Scalars["String"];
  ref: Scalars["String"];
}>;

export interface CanUserEditProjectQuery {
  project: Pick<Project, "canUserEdit"> & {
    dependencies: Pick<Release, "pathWithNamespace" | "canUserEdit">[];
  };
}

export type CommitActionsMutationVariables = Exact<{
  pathWithNamespace: Scalars["String"];
  actions: CommitAction[] | CommitAction;
  message: Scalars["String"];
  includeFullProject: Scalars["Boolean"];
  accessCode?: Maybe<Scalars["String"]>;
}>;

export interface CommitActionsMutation {
  createCommit: {
    project?: Maybe<Pick<Project, "updatedAt"> & FullProjectFragmentFragment>;
    commit: Pick<Commit, "id" | "message" | "createdAt">;
  };
}

export interface ForkAndReleaseBehaviorsMutation {
  forkAndReleaseBehavior: {
    sourceProject: Pick<Project, "updatedAt"> & FilesFragmentFragment;
    behaviorProject: Pick<Project, "pathWithNamespace" | "ref">;
  };
}

type PartialProjectFragmentFragment = Pick<
  Project,
  "pathWithNamespace" | "name" | "updatedAt" | "type" | "visibility"
> & {
  latestRelease?: Maybe<Pick<ReleaseBasic, "createdAt" | "tag">>;
  forkOf?: Maybe<Pick<ForkOfProject, "pathWithNamespace">>;
};

export type PartialProjectByPathQueryVariables = Exact<{
  pathWithNamespace: Scalars["String"];
  version: Scalars["String"];
}>;

export interface PartialProjectByPathQuery {
  project: PartialProjectFragmentFragment;
}

export type ProjectHistoryQueryVariables = Exact<{
  pathWithNamespace: Scalars["String"];
  ref: Scalars["String"];
  pageToCurrent: Scalars["Boolean"];
  accessCode?: Maybe<Scalars["String"]>;
  createdBefore?: Maybe<Scalars["Date"]>;
}>;

interface FilesFragmentFragment {
  files: Pick<ProjectFile, "name" | "path" | "contents" | "ref">[];
  dependencies: (Pick<
    Release,
    | "pathWithNamespace"
    | "tag"
    | "latestReleaseTag"
    | "canUserEdit"
    | "visibility"
  > & {
    files: Pick<
      ProjectFile,
      "name" | "path" | "dependencyPath" | "contents" | "ref"
    >[];
  })[];
}

type FullProjectFragmentFragment = Pick<
  Project,
  | "id"
  | "name"
  | "description"
  | "image"
  | "thumbnail"
  | "createdAt"
  | "updatedAt"
  | "canUserEdit"
  | "pathWithNamespace"
  | "namespace"
  | "type"
  | "ref"
  | "visibility"
  | "ownerType"
  | "keywords"
> & {
  forkOf?: Maybe<Pick<ForkOfProject, "pathWithNamespace">>;
  latestRelease?: Maybe<Pick<ReleaseBasic, "tag" | "createdAt">>;
  license?: Maybe<Pick<License, "id" | "name">>;
} & FilesFragmentFragment;

export type ProjectByPathQueryVariables = Exact<{
  pathWithNamespace: Scalars["String"];
  version: Scalars["String"];
  accessCode?: Maybe<Scalars["String"]>;
}>;

export interface ProjectByPathQuery {
  project: FullProjectFragmentFragment;
}
