// tslint:disable
export type Maybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  JSONObject: any;
  Date: any;
  JSON: any;
  Upload: any;
};

/** The queries available in this schema */
export type Query = {
  /** A flat list of active cache keys */
  cacheFlat: Array<Scalars['String']>;
  /** Active cache keys structured by namespace, resource, and query */
  cacheStructured: Scalars['JSONObject'];
  /** Retrieve a list of application build URLs */
  coreVersions?: Maybe<Array<Scalars['String']>>;
  /** Query for scraped datasets (admin only) */
  scrapedDatasets: ScrapedDatasetResults;
  datasetFilterValues: DatasetFilterValues;
  /** Retrieve an experiment run by its id */
  experimentRun?: Maybe<ExperimentRun>;
  /** Retrieve a specific run by its id */
  simulationRun?: Maybe<SimulationRun>;
  /** Generate an experiment plan from a selected definition in an experiments.json object */
  experimentPlan: ExperimentPlan;
  /** Retrieve a project issue */
  issue: Issue;
  /** Return all keywords in use across the Index */
  keywords: Array<Keyword>;
  /**
   * License which may be used to publish items to the Index under.
   *
   * If no suitable license is listed, publishers are advised to select Copyright
   * (All Rights Reserved) and then note their specific usage conditions in the
   * listing's descriptions.
   */
  licenses: Array<License>;
  /** Retrieve a project merge request */
  mergeRequest: MergeRequest;
  /** Retrieve data on a specific organization by its ID or name. One of ID or name must be supplied */
  org?: Maybe<Org>;
  /** Retrieve data on all organizations, or those with names containing a specific string */
  orgs?: Maybe<Array<Org>>;
  /** Return a PolyModel by its slug */
  polyModel: PolyModel;
  /** Return all PolyModels available via the HASH API */
  polyModels: Array<PolyModel>;
  /** Retrieve a project by its path */
  project: Project;
  /** Retrieve a release of a particular project */
  release: Release;
  /**
   * "
   * Query for special types of projects
   */
  specialProjects: Array<Project>;
  /** Search for projects matching the filters specified. */
  searchProjects: ProjectSearchResults;
  /** Return all site-wide roles in the system */
  roles: Array<Role>;
  scrapers: Array<GitHubScraper>;
  source?: Maybe<Source>;
  /** Retrieve all available subject types in the system */
  subjects: Array<Subject>;
  /** Retrieve a subject. */
  subject: Subject;
  /** Retrieve all available properties in the system */
  properties: Array<Property>;
  /** Retrieve a property */
  property: Property;
  /** Information on the user making the request */
  me?: Maybe<User>;
  /** Retrieve all users by page, with optional filtering */
  users: UsersResult;
  /** Retrieve the details of a specific user by their ID, email address, or shortname */
  user?: Maybe<User>;
  /** Retrieve a user or organization by their shortname or id */
  userOrOrg?: Maybe<UserOrOrg>;
  /**
   * Fetch available integrations, either for this user,
   * or for this user that are also authorized for the given projectId.
   */
  availableIntegrations: Array<Integration>;
  /** Fetch full integration information -- _WILL_ include the secret of the credential itself if the user is allowed access. */
  integration?: Maybe<FullIntegration>;
  /** Internal-only endpoint for fetching integrations. */
  integrations: Array<FullIntegration>;
  /**
   * Retrieves the set of integrations to be used for a given user and project.
   * Errors out if the user has not set up integrations properly for the project.
   */
  resolveIntegrations: Array<ResolvedIntegration>;
};


/** The queries available in this schema */
export type QueryScrapedDatasetsArgs = {
  perPage?: Maybe<Scalars['Int']>;
  page?: Maybe<Scalars['Int']>;
  sort?: Maybe<ScrapedSortOption>;
  filters?: Maybe<ScrapedDatasetFilters>;
};


/** The queries available in this schema */
export type QueryExperimentRunArgs = {
  id: Scalars['ID'];
};


/** The queries available in this schema */
export type QuerySimulationRunArgs = {
  id: Scalars['ID'];
};


/** The queries available in this schema */
export type QueryExperimentPlanArgs = {
  name: Scalars['String'];
  experimentsSrc: Scalars['String'];
};


/** The queries available in this schema */
export type QueryIssueArgs = {
  projectPath: Scalars['String'];
  issueId: Scalars['Int'];
};


/** The queries available in this schema */
export type QueryMergeRequestArgs = {
  projectPath: Scalars['String'];
  mergeRequestId: Scalars['Int'];
};


/** The queries available in this schema */
export type QueryOrgArgs = {
  id?: Maybe<Scalars['ID']>;
  name?: Maybe<Scalars['String']>;
  shortname?: Maybe<Scalars['String']>;
};


/** The queries available in this schema */
export type QueryOrgsArgs = {
  name?: Maybe<Scalars['String']>;
};


/** The queries available in this schema */
export type QueryPolyModelArgs = {
  slug: Scalars['String'];
};


/** The queries available in this schema */
export type QueryProjectArgs = {
  projectPath?: Maybe<Scalars['String']>;
  ref?: Maybe<Scalars['String']>;
  oldId?: Maybe<Scalars['ID']>;
  oldType?: Maybe<OldProjectType>;
  accessCode?: Maybe<Scalars['String']>;
};


/** The queries available in this schema */
export type QueryReleaseArgs = {
  projectPath: Scalars['String'];
  tag?: Maybe<Scalars['String']>;
  files?: Maybe<Array<Scalars['String']>>;
};


/** The queries available in this schema */
export type QuerySpecialProjectsArgs = {
  type: SpecialProjectType;
};


/** The queries available in this schema */
export type QuerySearchProjectsArgs = {
  query?: Maybe<Scalars['String']>;
  subjects?: Maybe<Array<Scalars['String']>>;
  types?: Maybe<Array<SearchableTypeName>>;
  perPage?: Maybe<Scalars['Int']>;
  page?: Maybe<Scalars['Int']>;
  sort?: Maybe<SortOption>;
  language?: Maybe<BehaviorLanguage>;
  temporalCoverage?: Maybe<Scalars['String']>;
  dataFrequency?: Maybe<Scalars['String']>;
  spatialCoverage?: Maybe<Scalars['String']>;
  releasedOnly?: Maybe<Scalars['Boolean']>;
};


/** The queries available in this schema */
export type QuerySubjectsArgs = {
  onlyPopulated?: Maybe<Array<ProjectTypeFilter>>;
};


/** The queries available in this schema */
export type QuerySubjectArgs = {
  name: Scalars['String'];
  namespace?: Maybe<Scalars['String']>;
  version?: Maybe<Scalars['String']>;
};


/** The queries available in this schema */
export type QueryPropertyArgs = {
  name: Scalars['String'];
  namespace?: Maybe<Scalars['String']>;
  version?: Maybe<Scalars['String']>;
};


/** The queries available in this schema */
export type QueryUsersArgs = {
  page?: Maybe<Scalars['Int']>;
  sort?: Maybe<UserSortOption>;
  sortDirection?: Maybe<SortDirection>;
  search?: Maybe<Scalars['String']>;
  filter?: Maybe<Scalars['String']>;
};


/** The queries available in this schema */
export type QueryUserArgs = {
  id?: Maybe<Scalars['ID']>;
  email?: Maybe<Scalars['String']>;
  shortname?: Maybe<Scalars['String']>;
};


/** The queries available in this schema */
export type QueryUserOrOrgArgs = {
  shortname?: Maybe<Scalars['String']>;
  id?: Maybe<Scalars['ID']>;
};


/** The queries available in this schema */
export type QueryAvailableIntegrationsArgs = {
  types?: Maybe<Array<SourceTypeName>>;
  hFlowOnly?: Maybe<Scalars['Boolean']>;
  namespaceId?: Maybe<Scalars['ID']>;
  projectId?: Maybe<Scalars['ID']>;
};


/** The queries available in this schema */
export type QueryIntegrationArgs = {
  id: Scalars['ID'];
};


/** The queries available in this schema */
export type QueryIntegrationsArgs = {
  ids: Array<Scalars['ID']>;
};


/** The queries available in this schema */
export type QueryResolveIntegrationsArgs = {
  projectId: Scalars['ID'];
};


export enum ScrapedSortOption {
  /** The date the dataset was last modified */
  DateModified = 'dateModified',
  /** The date the dataset was originally published */
  DatePublished = 'datePublished'
}

export type ScrapedDatasetFilters = {
  /** A text string to search */
  query?: Maybe<Scalars['String']>;
  /** The name of the organization as listed in the source */
  publisher?: Maybe<Scalars['String']>;
  published?: Maybe<FlagToggle>;
  ignored?: Maybe<FlagToggle>;
  updated?: Maybe<FlagToggle>;
  fileFormat?: Maybe<FormatFilter>;
  zip?: Maybe<FlagToggle>;
};

export enum FlagToggle {
  /** Include results with the flag */
  Include = 'include',
  /** Exclude results with the flag */
  Exclude = 'exclude',
  /** Only show results with the flag */
  Only = 'only'
}

export enum FormatFilter {
  /** Show results with any files */
  Any = 'any',
  /** Show results with no files */
  None = 'none',
  /** Only show results with an accepted file format */
  Accepted = 'accepted',
  /** Only show results with a CSV file */
  Csv = 'csv',
  /** Only show results with a JSON file */
  Json = 'json'
}

export type ScrapedDatasetResults = {
  /** The results for the query, limited to the requested page */
  results: Array<ScrapedDataset>;
  /** The number of results requested */
  perPage: Scalars['Int'];
  /** The page requested */
  page: Scalars['Int'];
  /** The total number of datasets matching the query */
  totalCount: Scalars['Int'];
  /** The publishers available for query */
  publishers: Array<PublisherCount>;
  /** The filter settings for the query */
  filters: ScrapedDatasetFiltersUsed;
};

export type ScrapedDataset = {
  /** The source the dataset was scraped from */
  source?: Maybe<Scalars['String']>;
  /** The id used to identify the dataset in its original source */
  sourceId?: Maybe<Scalars['String']>;
  /** The URL to view the dataset in its original source */
  sourceUrl?: Maybe<Scalars['String']>;
  /** The id of this specific revision of the dataset */
  revisionId?: Maybe<Scalars['String']>;
  /** Whether or not the dataset has been published to the Index */
  published?: Maybe<Scalars['Boolean']>;
  /** Whether or not the dataset has been permanently ignored */
  ignored?: Maybe<Scalars['Boolean']>;
  /**
   * Whether or not a dataset has been actioned from the approval queue (i.e.
   * published, updated, temporarily ignored, or permanently ignored)
   */
  actioned?: Maybe<Scalars['Boolean']>;
  /** Whether a dataset has been updated since its publication on HASH */
  updated?: Maybe<Scalars['Boolean']>;
  /** Whether a dataset has been handled/actioned from the queue */
  handled?: Maybe<Scalars['Boolean']>;
  /** An exteral webpage for the dataset or dataset series */
  landingPage?: Maybe<Scalars['String']>;
  /** Additional reference information for the dataset */
  references?: Maybe<Array<Maybe<Scalars['String']>>>;
  version?: Maybe<Scalars['String']>;
  language?: Maybe<Array<Maybe<Scalars['String']>>>;
  /** Date published of the dataset itself, not the db entry (createdAt) */
  datePublished?: Maybe<Scalars['Date']>;
  /** Date the dataset itself was updated, not the db entry (createdAt) */
  dateModified?: Maybe<Scalars['Date']>;
  /** How frequently the dataset is updated */
  updateFreq?: Maybe<Scalars['String']>;
  /** Keywords or tags associated with the dataset */
  keywords?: Maybe<Array<Maybe<Scalars['String']>>>;
  /** The keywords listed in the source */
  keywordsInSource?: Maybe<Array<Maybe<Scalars['String']>>>;
  contactPoint?: Maybe<Scalars['String']>;
  contactPointEmail?: Maybe<Scalars['String']>;
  /** The period of time the dataset covers */
  temporalCoverage?: Maybe<Scalars['String']>;
  /** The frequency interval of the datapoints within the dataset */
  temporalFrequency?: Maybe<Scalars['String']>;
  /** The physical area covered by the dataset */
  spatialCoverage?: Maybe<Scalars['String']>;
  /** Additional information about the rights held or offered on the dataset */
  rights?: Maybe<Scalars['String']>;
  /** The name of a collection or group the dataset belongs to */
  isPartOf?: Maybe<Scalars['String']>;
  /** The International Standard Serial Number used to identify a serial publication */
  issn?: Maybe<Scalars['String']>;
  /** The technique(s) used to measure the data */
  measurementTechnique?: Maybe<Scalars['String']>;
  /** The specific variable the data measures */
  variableMeasured?: Maybe<Scalars['String']>;
  /** The name of the data catalog the resource is included in, if any */
  includedInDataCatalog?: Maybe<Scalars['String']>;
  /** The HASH id(s) of the category the dataset has been published under */
  category?: Maybe<Array<Scalars['ID']>>;
  /** The category(s) listed in the source */
  categoryInSource?: Maybe<Array<Maybe<Scalars['String']>>>;
  /** The HASH id of the organization the dataset has been published under */
  publisher?: Maybe<Scalars['ID']>;
  /** The publisher listed in the source (this will be the same as the organization if no other specific publisher was listed) */
  publisherInSource?: Maybe<Scalars['String']>;
  /** The name of the organization responsible for the datase listed in the source */
  organizationInSource?: Maybe<Scalars['String']>;
  /** A URL to the logo of the organization responsible for the dataset */
  organizationLogoInSource?: Maybe<Scalars['String']>;
  /** The HASH id of the license the dataset has been published under */
  license?: Maybe<Scalars['ID']>;
  /** The license listed in the source */
  licenseInSource?: Maybe<Scalars['String']>;
  /** A URL describing the license the dataset is made available under */
  licenseUrlInSource?: Maybe<Scalars['String']>;
  /** The subject listed in the source */
  subjectInSource?: Maybe<Scalars['String']>;
  /** The HASH id of the subject or subjects of the dataset */
  subject?: Maybe<Array<Scalars['ID']>>;
  /** Files associated with the dataset */
  resources?: Maybe<Array<Maybe<DatasetResource>>>;
  /** The ID used for identifying a specific dataset */
  id: Scalars['ID'];
  /** The title of the dataset */
  title?: Maybe<Scalars['String']>;
  /** A friendly name for the dataset */
  name?: Maybe<Scalars['String']>;
  /** A description, instructions or notes on the dataset */
  description?: Maybe<Scalars['String']>;
  /** The url from which the dataset can be downloaded */
  url?: Maybe<Scalars['String']>;
  /** The date/time the database record for the dataset was last updated */
  updatedAt?: Maybe<Scalars['Date']>;
  /** The date/time the dataset was added to the database */
  createdAt?: Maybe<Scalars['Date']>;
};


/** A resource or file associated with a dataset */
export type DatasetResource = {
  /** The id of the resource in its source */
  id?: Maybe<Scalars['String']>;
  /** The revisionId of the dataset this resource was introduced in */
  revisionId?: Maybe<Scalars['String']>;
  /** The format of the file available under url */
  format?: Maybe<Scalars['String']>;
  /** A description of the resource */
  description?: Maybe<Scalars['String']>;
  /** A URL to a file describing the resource */
  describedBy?: Maybe<Scalars['String']>;
  /** The type of file listed under describedBy */
  describedByType?: Maybe<Scalars['String']>;
  /** The name of the resource */
  name?: Maybe<Scalars['String']>;
  /** URL to the resource itself, or its landing page */
  url?: Maybe<Scalars['String']>;
  /** A preview of the dataset's first 30 rows (CSV only) */
  preview?: Maybe<Array<Maybe<Array<Maybe<Scalars['String']>>>>>;
  /** The size of the file */
  size?: Maybe<Scalars['String']>;
  createdAt?: Maybe<Scalars['String']>;
  updatedAt?: Maybe<Scalars['String']>;
};

export type PublisherCount = {
  name: Scalars['String'];
  count: Scalars['Int'];
};

export type ScrapedDatasetFiltersUsed = {
  /** A text string to search */
  query?: Maybe<Scalars['String']>;
  publisher?: Maybe<Scalars['String']>;
  published?: Maybe<FlagToggle>;
  handled?: Maybe<FlagToggle>;
  ignored?: Maybe<FlagToggle>;
  updated?: Maybe<FlagToggle>;
  fileFormat?: Maybe<FormatFilter>;
};

export type DatasetFilterValues = {
  temporalCoverage: Array<Scalars['String']>;
  dataFrequency: Array<Scalars['String']>;
  spatialCoverage: Array<Scalars['String']>;
};

export type ExperimentRun = {
  id: Scalars['ID'];
  /** A friendly name for the ExperimentRun */
  name: Scalars['String'];
  /** The project the experiment is related to. */
  project: Project;
  /** The full path to the project this experiment is related to */
  projectPath: Scalars['String'];
  /** The name of the experiment package to run */
  packageName: ExperimentPackageName;
  /** Contextual data needed by the experiment package, if any */
  packageData?: Maybe<ExperimentPackageData>;
  /** Information on which simulation packages to run in this experiment */
  simPackages?: Maybe<Array<SimulationPackageData>>;
  /** The specific commit this experiment was started from */
  commit: Scalars['String'];
  /** The individual runs within the experiment. */
  simulationRuns: Array<SimulationRun>;
  /** The contents of experiment.json used to generate the experiment. */
  experimentSrc?: Maybe<Scalars['JSONObject']>;
  /** The source files needed to run the simulation, including dependencies */
  simulationFiles: Array<ProjectFile>;
  /**
   * [DEPRECATED - use packageData.changedProperties] All the different property
   * configurations used to generate the individual runs
   */
  changedProperties?: Maybe<Array<Scalars['JSONObject']>>;
  /**
   * [DEPRECATED - see simulationFiles instead] If the simulation depends on any
   * shared behaviors, they will be provided here in createExperimentRun returns
   */
  sharedBehaviors?: Maybe<Array<Maybe<Array<ProjectFile>>>>;
  /**
   * [DEPRECATED - see simulationFiles instead] If the simulation depends on any
   * shared datasets, they will be provided here in createExperimentRun returns
   */
  sharedDatasets?: Maybe<Array<Maybe<Array<ProjectFile>>>>;
  /** When the ExperimentRun was initiated. */
  createdAt: Scalars['Date'];
  /** When the ExperimentRun was last updated (e.g. with compute usage). */
  updatedAt: Scalars['Date'];
  /** When the experiment's cloud compute usage was finalised (usually when the experiment ended) */
  usageFinalisedAt?: Maybe<Scalars['Date']>;
  /** The user that initiated the experiment */
  user?: Maybe<User>;
  /** How much cloud compute time the experiment used (in seconds) */
  computeUsage: Scalars['Int'];
};

/** A collection of files that might be a simulation, dataset(s), or behavior(s) */
export type Project = {
  /** The MongoDB ObjectId of the project */
  _id: Scalars['ID'];
  /** The ID of the project */
  id: Scalars['ID'];
  /** A friendly name for the project */
  name: Scalars['String'];
  /** The slug of the project */
  path: Scalars['String'];
  /** The namespace the resource belongs to, which represents either a user or an organization */
  namespace: Scalars['String'];
  /** The user or organisation which owns the resource */
  owner?: Maybe<UserOrOrg>;
  /** Whether the owner is a user or an org */
  ownerType: OwnerTypeName;
  /** The full path of the resource, including its namespace and path/name, in the format @namespace/path */
  pathWithNamespace: Scalars['String'];
  /** The level of access restriction on the resource */
  visibility: VisibilityLevel;
  /** A status given to some projects */
  trusted?: Maybe<Scalars['Boolean']>;
  /** The total size of the project, in bytes */
  size?: Maybe<Scalars['Int']>;
  /** A short description of the project */
  description?: Maybe<Scalars['String']>;
  /** A mirror of README.md from the project repository */
  readme?: Maybe<Scalars['String']>;
  /** The type of data model the project relates to */
  type: ProjectTypeName;
  /** Whether or not the project is archived (read-only and hidden from search results) */
  archived: Scalars['Boolean'];
  /** The file contents of the project */
  files: Array<ProjectFile>;
  /** Experiments run on the project by the user or fellow organisation members */
  experiments?: Maybe<Array<ExperimentRun>>;
  history?: Maybe<ProjectHistoryReturn>;
  /** The branch or tag at which this project was requested (if any) */
  ref?: Maybe<Scalars['String']>;
  /** A URL to an image or video representing the project */
  avatar?: Maybe<Scalars['String']>;
  /** Issues raised against a project */
  issues: Array<Issue>;
  contributors: Array<ContributorInfo>;
  /** The number of open issues on a project */
  issueCount: Scalars['Int'];
  /** Merge requests open against a project */
  mergeRequests: Array<MergeRequest>;
  /** The number of open merge requests on a project */
  mergeRequestCount: Scalars['Int'];
  /** Where the project avatar is a video, this is an URL to an image frame from the video to act as a thumbnail or fallback */
  thumbnail?: Maybe<Scalars['String']>;
  /** A URL to a wide-ratio (1.91:1) cover image to promote and illustrate projects */
  image?: Maybe<Scalars['String']>;
  /** Keywords / tags to help users locate the project */
  keywords: Array<Scalars['String']>;
  /** The license the work is made available under */
  license?: Maybe<License>;
  /** The subject(s) of the project */
  subject: Array<Subject>;
  /**
   * The percentage of behaviors in the project written in each programming
   * language (only available in Simulation or Behavior projects with releases -
   * calculation applies to the latest release)
   */
  languageSplit?: Maybe<Array<LanguageSplit>>;
  /** For behavior releases only, the languages of the released behaviors */
  languages?: Maybe<Array<BehaviorLanguage>>;
  /** The original source of the project (for dataset projects) */
  source?: Maybe<Scalars['String']>;
  /** An external webpage for the dataset or dataset series */
  landingPage?: Maybe<Scalars['String']>;
  /** The period of time the project covers */
  temporalCoverage?: Maybe<Scalars['String']>;
  /** The frequency interval of the datapoints within the project (for datasets) */
  dataFrequency?: Maybe<Scalars['String']>;
  /** The physical area covered by the project */
  spatialCoverage?: Maybe<Scalars['String']>;
  /** The number of times a project has been forked */
  forkCount: Scalars['Int'];
  /** The number of times a project has been starred */
  starCount: Scalars['Int'];
  /** What project, if any, this project is a fork of */
  forkOf?: Maybe<ForkOfProject>;
  /** The paths of forks of the project the requesting user organization has */
  orgForkPaths?: Maybe<Array<Scalars['String']>>;
  /** The paths of forks of the project the requesting user has */
  userForkPaths?: Maybe<Array<Scalars['String']>>;
  /** The number of forks of the project the requesting user has */
  userForkCount?: Maybe<Scalars['Int']>;
  /** The dependencies listed in a project */
  dependencies: Array<Release>;
  /** The number of simulations that depend on an item within the listing */
  dependents?: Maybe<Scalars['Int']>;
  /** A weighted score of the listing's relevance to a search query */
  relevance?: Maybe<Scalars['Float']>;
  /** A score assigned to the popularity of the project */
  popularity: Scalars['Int'];
  /** The latest release of the project (if any) */
  latestRelease?: Maybe<ReleaseBasic>;
  /** All releases of a project */
  releases: Array<ReleaseBasic>;
  /** A temporary URL from which the project can be downloaded as a zip file */
  downloadUrl?: Maybe<Scalars['String']>;
  /** The date the project was originally created */
  createdAt: Scalars['Date'];
  /** The date the project was last updated */
  updatedAt: Scalars['Date'];
  /**
   * Whether or not the logged-in user can edit the project. To do so, one of the following must be true:
   *
   * 1) The user is a site admin OR
   * 2) The project owner is the user OR
   * 3) The project owner is an organization to which the user belongs
   */
  canUserEdit: Scalars['Boolean'];
  /**
   * Whether or not the logged-in user can fork the project. Projects cannot be
   * forked into the namespace they already exist in.
   */
  canUserFork: Scalars['Boolean'];
};


/** A collection of files that might be a simulation, dataset(s), or behavior(s) */
export type ProjectFilesArgs = {
  withPreview?: Maybe<Scalars['Boolean']>;
};


/** A collection of files that might be a simulation, dataset(s), or behavior(s) */
export type ProjectExperimentsArgs = {
  limit?: Maybe<Scalars['Int']>;
  createdFrom?: Maybe<Scalars['String']>;
};


/** A collection of files that might be a simulation, dataset(s), or behavior(s) */
export type ProjectHistoryArgs = {
  createdBefore?: Maybe<Scalars['Date']>;
  pageToCurrent?: Maybe<Scalars['Boolean']>;
};


/** A collection of files that might be a simulation, dataset(s), or behavior(s) */
export type ProjectIssuesArgs = {
  labels?: Maybe<Array<IssueLabel>>;
  state?: Maybe<IssueState>;
};


/** A collection of files that might be a simulation, dataset(s), or behavior(s) */
export type ProjectMergeRequestsArgs = {
  state?: Maybe<MergeRequestState>;
};

export type UserOrOrg = User | Org;

/** A registered user of the prototype HASH ecosystem */
export type User = {
  /** The unique ID */
  id: Scalars['ID'];
  /** The user's given / first name */
  givenName?: Maybe<Scalars['String']>;
  /** The user's GitLab ID.  */
  gitId: Scalars['Int'];
  /** Any additional name(s) the user has */
  additionalName?: Maybe<Array<Scalars['String']>>;
  /** The user's family name / surname / last name */
  familyName?: Maybe<Scalars['String']>;
  /**
   * The user's given and family names combined, OR their given name if no family
   * name is present, OR their email if no name at all is present
   */
  fullName: Scalars['String'];
  /** A unique string identifying the user in HASH */
  shortname: Scalars['String'];
  /** The user's role */
  role?: Maybe<Role>;
  /** The user's email address */
  email?: Maybe<Scalars['String']>;
  /** The user's telephone number */
  telephone?: Maybe<Scalars['String']>;
  /** A brief description of the user's history / profile */
  biography?: Maybe<Scalars['String']>;
  /** Where the user is geographically based */
  location?: Maybe<Scalars['String']>;
  /** The language(s) the user knows */
  knowsLanguage?: Maybe<Array<Scalars['String']>>;
  /** The user's website */
  url?: Maybe<Scalars['String']>;
  /** An image representing the user / their avatar */
  image?: Maybe<Scalars['String']>;
  /** The start of the user's latest session on HASH */
  lastLogin?: Maybe<Scalars['Date']>;
  /** The user's registered payment methods */
  paymentMethods?: Maybe<Array<PaymentMethod>>;
  /** How many compute seconds the user has remaining this month */
  computeUsageRemaining: Scalars['Int'];
  /** The user's past invoices */
  invoices?: Maybe<Array<Invoice>>;
  /** Outstanding balance on a user's account for which an invoice has not been finalized */
  upcomingInvoice?: Maybe<Invoice>;
  /** List the paths of projects a user has starred */
  starredProjects: Array<Scalars['String']>;
  /** Full details of projects a user has starred, sorted and paginated */
  starredProjectsDetails: UserOrOrgProjectResults;
  archived?: Maybe<Scalars['Boolean']>;
  /** Organisations the user belongs to, and their role in each */
  memberOf?: Maybe<Array<OrgInfo>>;
  /** Projects belonging to the namespace */
  projects: UserOrOrgProjectResults;
  /** The number of projects belonging to the namespace */
  projectCount: Scalars['Int'];
  /** The type of projects the namespace has available */
  projectTypes: Array<ProjectTypeName>;
  /** Datasets which the user has write access to through ownership or sharing */
  datasets?: Maybe<Array<Dataset>>;
  /** The date/time the user's record was created in the database */
  createdAt: Scalars['Date'];
  /** The date/time the users's record was last modified in the database */
  updatedAt: Scalars['Date'];
  /** [DEPRECATED] Whether or not the user has been through the HASH onboarding tour */
  onboarded?: Maybe<Scalars['Boolean']>;
  /** The user's progress through the onboarding tour */
  tourProgress?: Maybe<TourProgress>;
  /** Whether the user is a staff member */
  staffMember?: Maybe<Scalars['Boolean']>;
  /** [DEPRECATED] True if the user had early access to the HASH Cloud */
  earlyCloudAccess?: Maybe<Scalars['Boolean']>;
};


/** A registered user of the prototype HASH ecosystem */
export type UserStarredProjectsDetailsArgs = {
  page?: Maybe<Scalars['Int']>;
  sort?: Maybe<SortOption>;
};


/** A registered user of the prototype HASH ecosystem */
export type UserProjectsArgs = {
  page?: Maybe<Scalars['Int']>;
  sort?: Maybe<SortOption>;
  types?: Maybe<Array<ProjectTypeName>>;
};

/** The site-wide role the user holds */
export type Role = {
  /** Role ID */
  id: Scalars['ID'];
  /** Role name */
  name: Scalars['String'];
  /** A longer description of the role */
  description?: Maybe<Scalars['String']>;
};

export type PaymentMethod = {
  id: Scalars['ID'];
  brand?: Maybe<Scalars['String']>;
  expiry: Scalars['String'];
  last4: Scalars['String'];
  default?: Maybe<Scalars['Boolean']>;
};

export type Invoice = {
  number: Scalars['String'];
  status: Scalars['String'];
  created: Scalars['Date'];
  periodStart: Scalars['Date'];
  periodEnd: Scalars['Date'];
  total: Scalars['Int'];
  /**
   * For invoices requiring payment, the client secret for the PaymentIntent.
   * Needed in order to process an on-session payment in the client.
   */
  clientSecret?: Maybe<Scalars['String']>;
};

export enum SortOption {
  /**
   * Where a text query is provided, a score representing how well the project's
   * title, keywords and description match the query
   */
  Relevance = 'relevance',
  /** Combined view and download count for the project */
  Popularity = 'popularity',
  /** The date the project was last modified */
  UpdatedAt = 'updatedAt',
  /** The date the project was originally created */
  CreatedAt = 'createdAt'
}

export type UserOrOrgProjectResults = {
  /** The requested page of results */
  results: Array<Project>;
  /** The total number of available results (of the selected type, if filtered) */
  totalCount: Scalars['Int'];
  /** The page returned */
  page: Scalars['Int'];
  /** The sort applied */
  sort: SortOption;
  /** The type filter(s) applied, if any */
  types?: Maybe<Array<ProjectTypeName>>;
};

/** The names of possible types of items a project */
export enum ProjectTypeName {
  Simulation = 'Simulation',
  Dataset = 'Dataset',
  Behavior = 'Behavior'
}

export type OrgInfo = {
  /** Information on the organisation */
  org: Org;
  /** The user's access/permission level for the organization */
  role: Role;
  /** The user's job title in the organization */
  jobTitle?: Maybe<Scalars['String']>;
};

/** An organization, company, etc */
export type Org = {
  /** The unique ID of the organization */
  id: Scalars['ID'];
  /** The short name for the organization */
  name: Scalars['String'];
  /** The organization's GitLab ID. */
  gitId: Scalars['Int'];
  /** Alternate name(s) the organization may be referred to as */
  alternateName?: Maybe<Array<Scalars['String']>>;
  /** Free single-line text to specify organization location (see 'address' for postal address) */
  location?: Maybe<Scalars['String']>;
  /** The physical address(es) of the organization (see 'location' for a single line of free text) */
  address?: Maybe<Array<PostalAddress>>;
  /** A description of the organization */
  description?: Maybe<Scalars['String']>;
  /** The full legal name of the organization */
  legalName?: Maybe<Scalars['String']>;
  /** A unique string identifying the organization in HASH */
  shortname: Scalars['String'];
  /** The parent organization of this organization, if any */
  parentOrganization?: Maybe<Org>;
  /** The subsidiaries / child organizations of this organization, if any */
  subOrganization?: Maybe<Array<Org>>;
  /** Whether the organization is non-profit or not */
  nonProfit?: Maybe<Scalars['Boolean']>;
  /** Users belonging to the organization */
  members?: Maybe<Array<User>>;
  /** The number of users belonging to the organization */
  memberCount?: Maybe<Scalars['Int']>;
  /** The roles available for members of the org (i.e. permissions over the org) */
  roles?: Maybe<Array<Role>>;
  /** Whether the organization's membership is made public or not */
  publicMembership: Scalars['Boolean'];
  /** A way for HASH users to contact the organization with any questions */
  supportContact?: Maybe<Scalars['String']>;
  /** The organization's logo */
  logo?: Maybe<Scalars['String']>;
  /** A square avatar representing the organization */
  avatar?: Maybe<Scalars['String']>;
  /** Any other images associated with the organization */
  image?: Maybe<Scalars['String']>;
  /** The organization's website(s) */
  url?: Maybe<Scalars['String']>;
  /** Projects belonging to the namespace */
  projects: UserOrOrgProjectResults;
  /** The number of projects belonging to the namespace */
  projectCount: Scalars['Int'];
  /** The type of projects the namespace has available */
  projectTypes: Array<ProjectTypeName>;
  /** Whether the current user may edit the org */
  canUserEdit: Scalars['Boolean'];
  /** When the org's HASH record was last updated */
  updatedAt: Scalars['Date'];
  /** When the org was created in HASH */
  createdAt: Scalars['Date'];
};


/** An organization, company, etc */
export type OrgProjectsArgs = {
  page?: Maybe<Scalars['Int']>;
  sort?: Maybe<SortOption>;
  types?: Maybe<Array<ProjectTypeName>>;
};

/** A physical address of an organization or entity */
export type PostalAddress = {
  /** The post office box number for PO box addresses. */
  postOfficeBoxNumber?: Maybe<Scalars['String']>;
  /** The street address. */
  streetAddress?: Maybe<Scalars['String']>;
  /** The locality in which the street address is (e.g. a town) */
  addressLocality?: Maybe<Scalars['String']>;
  /** The region (e.g. a state, county, or other top-level district in a country */
  addressRegion?: Maybe<Scalars['String']>;
  /** The country */
  addressCountry?: Maybe<Scalars['String']>;
  /** The postal code or zip code */
  postalCode?: Maybe<Scalars['String']>;
};

/** Metadata on a dataset for use in instantiating agents and other dataset properties */
export type Dataset = {
  /** The ID used for identifying a specific dataset */
  id: Scalars['ID'];
  /** A friendly name for the dataset */
  name?: Maybe<Scalars['String']>;
  /** The complete shortname for the dataset */
  shortname: Scalars['String'];
  /** A filename for the dataset */
  filename: Scalars['String'];
  /** The format of the dataset */
  format?: Maybe<Scalars['String']>;
  /** The file extension for the dataset, without period. e.g. 'csv' */
  extension: Scalars['String'];
  /** A description, instructions or notes on the dataset */
  description?: Maybe<Scalars['String']>;
  /** The subject or subjects of the dataset */
  subject: Array<Subject>;
  /** The url from which the dataset can be downloaded */
  url?: Maybe<Scalars['String']>;
  /** The date/time the database record for the dataset was last updated */
  updatedAt: Scalars['Date'];
  /** The date/time the dataset was added to the database */
  createdAt: Scalars['Date'];
  /** The original source of the dataset */
  source?: Maybe<Scalars['String']>;
  /** An exteral webpage for the dataset or dataset series */
  landingPage?: Maybe<Scalars['String']>;
  /** The size of the dataset in bytes */
  size?: Maybe<Scalars['String']>;
  /** The period of time the dataset covers */
  temporalCoverage?: Maybe<Scalars['String']>;
  /** The frequency interval of the datapoints within the dataset */
  temporalFrequency?: Maybe<Scalars['String']>;
  /** The physical area covered by the dataset */
  spatialCoverage?: Maybe<Scalars['String']>;
  /** A preview of the dataset's contents */
  preview?: Maybe<Scalars['String']>;
};

/** The subject of a dataset. */
export type Subject = {
  /** The unique identifier of the subject */
  id: Scalars['ID'];
  /** The name of the subject */
  name: Scalars['String'];
  /** The namespace the resource belongs to, which represents either a user or an organization */
  namespace: Scalars['String'];
  /** The user or organisation which owns the resource */
  owner?: Maybe<UserOrOrg>;
  /** Whether the owner is a user or an org */
  ownerType: OwnerTypeName;
  /** The full path of the resource, including its namespace and path/name, in the format @namespace/path */
  pathWithNamespace: Scalars['String'];
  /** The level of access restriction on the resource */
  visibility: VisibilityLevel;
  /** Additional description of the subject */
  description?: Maybe<Scalars['String']>;
  /** The subject's direct parent(s) */
  subTypeOf?: Maybe<Array<Subject>>;
  /** All the subjects which this inherits from (including via its parents) */
  ancestors?: Maybe<Array<Subject>>;
  /** The direct children of this subject, if any */
  children?: Maybe<Array<Subject>>;
  /** The source this subject was forked from, if any */
  forkOf?: Maybe<SchemaReference>;
  /** A label showing the hierarchy or hierarchies above the subject */
  parentChain?: Maybe<Array<Scalars['String']>>;
  /** The subject's properties (whether belonging to itself directly, or via one of its ancestors) */
  properties?: Maybe<Array<PropertiesBySchema>>;
  /** The license the schema is made available under */
  license?: Maybe<License>;
  /** Which version of this subject this is. */
  version?: Maybe<Scalars['String']>;
  /** A weighted score of the subject's relevance to a search query */
  relevance?: Maybe<Scalars['Float']>;
  /** A score assigned to the popularity of the project */
  popularity: Scalars['Int'];
  /** Whether this is a ComplexType, or a primitive DataType */
  type: SubjectType;
  /** Can the requesting user edit this subject? */
  canUserEdit: Scalars['Boolean'];
  /** When the subject was created */
  createdAt: Scalars['Date'];
  /** When the subject was last updated */
  updatedAt: Scalars['Date'];
};

/** The type of entity that owns the project */
export enum OwnerTypeName {
  User = 'User',
  Org = 'Org'
}

/** The level of access restriction on the project */
export enum VisibilityLevel {
  /** Projects can be accessed by anyone */
  Public = 'public',
  /** Projects can only be accessed by users who have been granted access (either directly or via group membership) */
  Private = 'private'
}

export type SchemaReference = {
  name: Scalars['String'];
  namespace: Scalars['String'];
  version?: Maybe<Scalars['String']>;
};

export type PropertiesBySchema = {
  id: Scalars['ID'];
  schema: SchemaReference;
  properties: Array<Property>;
};

export type Property = {
  /** The unique identifier of the subject */
  id: Scalars['ID'];
  /** The property name */
  name: Scalars['String'];
  /** The namespace the resource belongs to, which represents either a user or an organization */
  namespace: Scalars['String'];
  /** The user or organisation which owns the resource */
  owner?: Maybe<UserOrOrg>;
  /** Whether the owner is a user or an org */
  ownerType: OwnerTypeName;
  /** The full path of the resource, including its namespace and path/name, in the format @namespace/path */
  pathWithNamespace: Scalars['String'];
  /** The level of access restriction on the resource */
  visibility: VisibilityLevel;
  /** A description of the property */
  description?: Maybe<Scalars['String']>;
  /** The subject(s) the property belongs directly to */
  propertyOf: Array<Subject>;
  /** The type of property or subject expected in this field */
  expectedType: Array<SchemaReference>;
  /** The superproperty of this property, if any */
  subPropertyOf?: Maybe<Array<SchemaReference>>;
  /** The subproperties of this property, if any */
  subProperties?: Maybe<Array<Property>>;
  /** The property which superseded this property, if any */
  supersededBy?: Maybe<SchemaReference>;
  /** The inverse of this property, if anything */
  inverseOf?: Maybe<SchemaReference>;
  /** Which version of this property this is. */
  version?: Maybe<Scalars['String']>;
  /** Can the requesting user edit this property? */
  canUserEdit: Scalars['Boolean'];
  /** When the property was created */
  createdAt: Scalars['Date'];
  /** When the property was last updated */
  updatedAt: Scalars['Date'];
};

/** A license under which a creative work is made available for viewing or use. */
export type License = {
  /** The unique identifier of the license */
  id: Scalars['ID'];
  /** An additional slug identifier for the license */
  key?: Maybe<Scalars['String']>;
  /** The name of the license */
  name: Scalars['String'];
  /** Additional description of the license */
  description?: Maybe<Scalars['String']>;
  /** A link to an explanation of the license's terms */
  url?: Maybe<Scalars['String']>;
  /** Whether the license is the default assigned when publishing to the Index */
  default?: Maybe<Scalars['Boolean']>;
  /** Whether the license is not part of the core list of selectable licenses - it is available for use only if searched for */
  nonCore?: Maybe<Scalars['Boolean']>;
  /** A URL for a logo for the license */
  logo?: Maybe<Scalars['String']>;
};

export enum SubjectType {
  ComplexType = 'ComplexType',
  DataType = 'DataType'
}

export type TourProgress = {
  completed: Scalars['Boolean'];
  version?: Maybe<Scalars['String']>;
  lastStepViewed?: Maybe<Scalars['String']>;
};

/** A file in a project repository */
export type ProjectFile = {
  /** A unique identifier within the repo */
  id: Scalars['ID'];
  /** The filename */
  name: Scalars['String'];
  /** The full path to the file within the repository */
  path: Scalars['String'];
  /**
   * The path the user refers to this by in their simulation logic.
   * If this is an imported dependency, its full path.
   * e.g. in the format @[namespace]/[slug]/[filename.ext]
   * For legacy behavior requests, this will be @[namespace]/[filename.ext]
   * For local datasets/behaviors, the filename.
   */
  dependencyPath: Scalars['String'];
  /** The contents of the file */
  contents: Scalars['String'];
  /** The size of the file in bytes */
  size: Scalars['Int'];
  /** The id of the last commit that affected the file */
  lastCommit: Scalars['String'];
  /** The id of the commit this file is from */
  commit: Scalars['String'];
  /** The branch or tag this version of the file is from */
  ref: Scalars['String'];
  /** "The type of file. Only currently implemented for Dataset */
  type?: Maybe<ProjectFileType>;
  /** The discovered subject of the dataset */
  discoveredSubject?: Maybe<Subject>;
};

export enum ProjectFileType {
  Dataset = 'Dataset',
  Behavior = 'Behavior'
}

export type ProjectHistoryReturn = {
  items: Array<ProjectHistoryItem>;
  next?: Maybe<Scalars['Date']>;
  remaining: Scalars['Boolean'];
  receivedCurrent: Scalars['Boolean'];
};

export type ProjectHistoryItem = {
  itemType: ProjectHistoryItemType;
  item: ProjectHistoryItemItem;
  createdAt: Scalars['Date'];
};

export enum ProjectHistoryItemType {
  Release = 'Release',
  CommitGroup = 'CommitGroup',
  ExperimentRun = 'ExperimentRun'
}

export type ProjectHistoryItemItem = ReleaseBasic | CommitGroup | ExperimentRun;

/** Basic information about a release */
export type ReleaseBasic = {
  /** The version number */
  tag: Scalars['String'];
  /** The date of the release */
  createdAt: Scalars['Date'];
  /** A note accompanying the release (e.g. changes since last version) */
  description?: Maybe<Scalars['String']>;
  /** The files exported from the release (or a subset of them if requested) */
  files: Array<ProjectFile>;
};


/** Basic information about a release */
export type ReleaseBasicFilesArgs = {
  withPreview?: Maybe<Scalars['Boolean']>;
};

export type CommitGroup = {
  commits: Array<Commit>;
};

export type Commit = {
  /** A unique id for the commit */
  id: Scalars['ID'];
  /** The commit message */
  message: Scalars['String'];
  /** Statistics on additions and deletions from the commit */
  stats: CommitStats;
  /** The time at which the commit was created */
  createdAt: Scalars['Date'];
};

export type CommitStats = {
  /** Lines added */
  additions: Scalars['Int'];
  /** Lines deleted */
  deletions: Scalars['Int'];
  /** Total actions */
  total: Scalars['Int'];
};

export enum IssueLabel {
  Bug = 'bug',
  Comment = 'comment',
  Request = 'request',
  Question = 'question'
}

export enum IssueState {
  Opened = 'opened',
  Closed = 'closed'
}

/** An issue raised on a project */
export type Issue = {
  /** The unique identifier of the issue globally */
  id: Scalars['Int'];
  /** The unique identifier of the issue within the project */
  iid: Scalars['Int'];
  /** The title of the issue */
  title: Scalars['String'];
  author?: Maybe<User>;
  /** A description of the issue */
  description: Scalars['String'];
  /** Label(s) representing the issue's type(s) */
  labels: Array<IssueLabel>;
  /** Whether the issue is open or closed */
  state: IssueState;
  /** Awards (emoji) the issue has received */
  awards: Array<Award>;
  /** Discussion threads on the issue */
  discussions: Array<Discussion>;
  /** Number of comments on the issue */
  notesCount: Scalars['Int'];
  createdAt: Scalars['Date'];
  updatedAt: Scalars['Date'];
  closedAt?: Maybe<Scalars['Date']>;
  closedBy?: Maybe<Scalars['String']>;
};

export type Award = {
  id: Scalars['Int'];
  /** The name of the award emoji (e.g. "thumbs-up") */
  name: EmojiName;
  /** The shortname of the awarding user */
  author: Scalars['String'];
};

export enum EmojiName {
  Thumbsup = 'thumbsup',
  Thumbsdown = 'thumbsdown'
}

/** A discussion thread on an issue or merge request */
export type Discussion = {
  /** The unique identifier of the discussion globally */
  id: Scalars['String'];
  /** Notes (comments) in the discussion thread */
  notes: Array<Note>;
};

export type Note = {
  author?: Maybe<User>;
  /** Emojis awarded to the note */
  awards: Array<Award>;
  /** The text content of the note */
  body: Scalars['String'];
  /** When the note was originally created */
  createdAt: Scalars['Date'];
  /** A globally unique id for the note */
  id: Scalars['Int'];
  /** The unique identifier of the noteable item within the project (iid) */
  noteableIid: Scalars['Int'];
  /** The type of noteable item */
  noteableType: NoteableTypeName;
  /** Whether or not it is possible to resolve/unresolve a note (Merge Requests only) */
  resolvable: Scalars['Boolean'];
  /** For resolvable notes, whether or not it is currently resolved */
  resolved?: Maybe<Scalars['Boolean']>;
  /** The shortname of the user who resolved the note */
  resolvedBy?: Maybe<Scalars['String']>;
  /** If the note is system-generated rather than user text content */
  system: Scalars['Boolean'];
  /** The last time the note was updated */
  updatedAt: Scalars['Date'];
};

export enum NoteableTypeName {
  Issue = 'Issue',
  MergeRequest = 'MergeRequest'
}

export type ContributorInfo = {
  id: Scalars['ID'];
  shortname: Scalars['String'];
  image: Scalars['String'];
  contributions: ContributionData;
};

export type ContributionData = {
  commits: Scalars['Int'];
};

export enum MergeRequestState {
  Opened = 'opened',
  Closed = 'closed',
  Locked = 'locked',
  Merged = 'merged'
}

/** A request to merge changes into a project branch */
export type MergeRequest = {
  /** The unique identifier of the merge request globally */
  id: Scalars['Int'];
  /** The unique identifier of the merge request within the project */
  iid: Scalars['Int'];
  /** The path of the project the merge request originated from, in the format @namespace/path */
  sourcePath: Scalars['String'];
  /** The path of the project the merge request is opened against, in the format @namespace/path */
  projectPath: Scalars['String'];
  /** The title of the merge request */
  title: Scalars['String'];
  author?: Maybe<User>;
  /** A description of the merge request */
  description: Scalars['String'];
  /** Label(s) representing the merge request's type(s) */
  labels?: Maybe<Array<MergeRequestLabel>>;
  /** The list of files changed as part of the merge request */
  changes: Array<FileChange>;
  /** Conflicts between the source and target branch, if any */
  conflicts?: Maybe<Array<MergeRequestConflict>>;
  /** Whether the merge request is open, closed, or merged */
  state: MergeRequestState;
  /** Whether or not the merge request may be merged */
  mergeable: Scalars['Boolean'];
  /** Whether or not the merge request has conflicts */
  hasConflicts: Scalars['Boolean'];
  /** Whether or not the merge request is marked as draft  */
  workInProgress: Scalars['Boolean'];
  /** Awards (emoji) the merge request has received */
  awards: Array<Award>;
  /** Discussion threads on the merge request */
  discussions: Array<Discussion>;
  /** Number of comments on the merge request */
  notesCount: Scalars['Int'];
  createdAt: Scalars['Date'];
  updatedAt: Scalars['Date'];
  closedAt?: Maybe<Scalars['Date']>;
  closedBy?: Maybe<Scalars['String']>;
  mergedAt?: Maybe<Scalars['Date']>;
  mergedBy?: Maybe<Scalars['String']>;
};

export enum MergeRequestLabel {
  Bugfix = 'bugfix',
  Feature = 'feature',
  Enhancement = 'enhancement'
}

export type FileChange = {
  deletedFile?: Maybe<Scalars['String']>;
  diff: Scalars['String'];
  newFile?: Maybe<Scalars['String']>;
  newPath?: Maybe<Scalars['String']>;
  oldPath?: Maybe<Scalars['String']>;
  aMode?: Maybe<Scalars['String']>;
  bMode?: Maybe<Scalars['String']>;
  renamedFile?: Maybe<Scalars['String']>;
};

export type MergeRequestConflict = {
  filePath: Scalars['String'];
  diff: Scalars['String'];
};

/** The languages in use in the project as of the latest release */
export type LanguageSplit = {
  language: BehaviorLanguage;
  percentage: Scalars['Float'];
};

export enum BehaviorLanguage {
  JavaScript = 'JavaScript',
  Python = 'Python',
  Rust = 'Rust'
}

export type ForkOfProject = {
  /** Project slug */
  path: Scalars['String'];
  /** The namespace the project belongs to */
  namespace: Scalars['String'];
  /** The full path of the project, including its namespace and path, in the format @namespace/path */
  pathWithNamespace: Scalars['String'];
};

/** A release of specific files from a project, with a version tag */
export type Release = {
  /** An id for the project */
  id: Scalars['String'];
  /** A friendly name for the project */
  name: Scalars['String'];
  /** The slug/shortname of the project */
  path: Scalars['String'];
  /** The visibility of the project */
  visibility: VisibilityLevel;
  /** The namespace the project belongs to, which represents either a user or an organization */
  namespace: Scalars['String'];
  /** The type of project this release relates to */
  type: ProjectTypeName;
  /** The full path of the project, including its namespace and path, in the format @namespace/path */
  pathWithNamespace: Scalars['String'];
  /** A description of the release */
  description?: Maybe<Scalars['String']>;
  /** The specific release tag/version these files relate to */
  tag: Scalars['String'];
  /** The date this version was released */
  createdAt: Scalars['Date'];
  /** The files exported from the release (or a subset of them if requested) */
  files: Array<ProjectFile>;
  /** Provides the tag from the most recent release */
  latestReleaseTag: Scalars['String'];
  /** The date of the latest release */
  latestCreatedAt: Scalars['String'];
  /**
   * Whether or not the logged-in user can edit the release's source project. To do so, one of the following must be true:
   *
   * 1) The user is a site admin OR
   * 2) The project owner is the user OR
   * 3) The project owner is an organization to which the user belongs
   */
  canUserEdit: Scalars['Boolean'];
};

export enum ExperimentPackageName {
  Simple = 'simple',
  Single = 'single',
  Optimization = 'optimization'
}

export type ExperimentPackageData = {
  /** The properties changed in an experiment (if known on creation) */
  changedProperties?: Maybe<Array<Scalars['JSONObject']>>;
  /** For optimization experiments, the metric to optimize for */
  metricName?: Maybe<Scalars['String']>;
  /** For optimization experiments, the objective for the metric */
  metricObjective?: Maybe<MetricObjective>;
  /** The maximum number of runs to try in an experiment */
  maxRuns?: Maybe<Scalars['Int']>;
  /** The maximum number of steps a run should go for */
  maxSteps?: Maybe<Scalars['Int']>;
  /** The minimum number of steps a run should go for before being terminated */
  minSteps?: Maybe<Scalars['Int']>;
  /** For optimization experiments, combinations of parameter values to use for the first runs. */
  initialPoints?: Maybe<Array<Scalars['JSONObject']>>;
  /** For optimization experiments, the fields to explore as hyperparameters */
  fields?: Maybe<Array<OptimizationField>>;
};

export enum MetricObjective {
  Max = 'max',
  Min = 'min'
}

export type OptimizationField = {
  name: Scalars['String'];
  /** A range of values to explore */
  range?: Maybe<Scalars['String']>;
  /** Discrete values to explore */
  values?: Maybe<Array<Maybe<Scalars['JSON']>>>;
  /** A distribution of values to explore */
  distribution?: Maybe<DistributionName>;
  /** For normal distribution */
  mean?: Maybe<Scalars['Int']>;
  /** For normal distribution */
  std?: Maybe<Scalars['Int']>;
  /** For beta distribution */
  alpha?: Maybe<Scalars['Int']>;
  /** For beta distribution */
  beta?: Maybe<Scalars['Int']>;
  /** For logNormal distribution */
  mu?: Maybe<Scalars['Int']>;
  /** For logNormal distribution */
  sigma?: Maybe<Scalars['Int']>;
  /** For poisson distribution */
  rate?: Maybe<Scalars['Int']>;
  /** For gamma distribution */
  shape?: Maybe<Scalars['Int']>;
  /** For gamma distribution */
  scale?: Maybe<Scalars['Int']>;
};


export enum DistributionName {
  Normal = 'normal',
  LogNormal = 'logNormal',
  Poisson = 'poisson',
  Beta = 'beta',
  Gamma = 'gamma'
}

export type SimulationPackageData = {
  name: Scalars['String'];
  data?: Maybe<Scalars['String']>;
};

export type SimulationRun = {
  id: Scalars['ID'];
  /**
   * The specific property values different in this SimulationRun compared to the
   * others in the ExperimentRun. Will be null if this was a single-run experiment.
   */
  propertyValues?: Maybe<Scalars['JSONObject']>;
  /** [DEPRECATED] - obsolete null value */
  propertiesSrc?: Maybe<Scalars['String']>;
  /** An optional name to help identify the SimulationRun */
  name?: Maybe<Scalars['String']>;
  /** For optimization experiments, the value of the metric of interest at the end of this run */
  metricOutcome?: Maybe<Scalars['Float']>;
  /** The folder in s3 this run's output is stored in, in the hash-experiments bucket */
  s3Key: Scalars['String'];
  /** the ExperimentRun this is a part of */
  experimentRun: ExperimentRun;
  /** The path to the project this run is associated with */
  projectPath: Scalars['String'];
  /** The commit this run's source code can be found at */
  commit: Scalars['String'];
  /** [DEPRECATED - use ExperimentRun.simulationFiles] The source code used to generate this run */
  files?: Maybe<Array<ProjectFile>>;
  /** URL to retrieve the JSON files containing steps data */
  stepsLink?: Maybe<Scalars['String']>;
  /** URL to retrieve the JSON files containing analysis data */
  analysisLink?: Maybe<Scalars['String']>;
  /** When the SimulationRun was initiated. */
  createdAt: Scalars['Date'];
  /** When the SimulationRun was last updated (e.g. to be renamed) */
  updatedAt?: Maybe<Scalars['Date']>;
};

export type ExperimentPlan = {
  plan: Scalars['JSONObject'];
  definition: Scalars['JSONObject'];
};

/** A keyword used to tag an item in the Index to indicate its theme, content, subject matter, etc */
export type Keyword = {
  /** The keyword itself */
  name: Scalars['String'];
  /** How many times the keyword appears across all Index listings */
  count?: Maybe<Scalars['String']>;
};

/** A 3D Object for use in visualizing simulations */
export type PolyModel = {
  /** The unique slug for the 3D model */
  slug: Scalars['String'];
  /** The path to the folder all the model assets are stored in */
  folderPath: Scalars['String'];
  /** Urls for resource files making up the 3D model */
  resourceUrls: Array<Scalars['String']>;
};

export enum OldProjectType {
  Simulation = 'Simulation',
  IndexListing = 'IndexListing'
}

export enum SpecialProjectType {
  Onboarding = 'Onboarding',
  Example = 'Example',
  Featured = 'Featured'
}

export enum SearchableTypeName {
  Simulation = 'Simulation',
  Dataset = 'Dataset',
  Behavior = 'Behavior',
  Schema = 'Schema'
}

export type ProjectSearchResults = {
  /** The results for the query, limited to the request page */
  results: Array<SearchableType>;
  /** The number of results requested */
  perPage: Scalars['Int'];
  /** The page requested */
  page: Scalars['Int'];
  /** The total number of listings matching the query */
  totalCount: Scalars['Int'];
  /** The field by which the results have been sorted */
  sort?: Maybe<SortOption>;
};

export type SearchableType = Project | Subject;

export type GitHubScraper = {
  createdAt: Scalars['Date'];
  creator: User;
  files: Array<GitHubScraperFile>;
  frequency: ScraperFrequency;
  lastCheckedAt?: Maybe<Scalars['Date']>;
  lastReleaseAt?: Maybe<Scalars['Date']>;
  name?: Maybe<Scalars['String']>;
  namespace: Scalars['String'];
  path: Scalars['String'];
  repoPath: Scalars['String'];
  status?: Maybe<ScraperStatus>;
};

export type GitHubScraperFile = {
  fileDownloadUrl: Scalars['String'];
  filepathInRepo: Scalars['String'];
  filenameInHASH: Scalars['String'];
  nameInHASH?: Maybe<Scalars['String']>;
};

export enum ScraperFrequency {
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly'
}

export enum ScraperStatus {
  Active = 'active',
  Error = 'error',
  Paused = 'paused'
}

export type Source = {
  name?: Maybe<Scalars['String']>;
  url?: Maybe<Scalars['String']>;
  publisher?: Maybe<Org>;
};

/** Whether to filter a response by a particular project type, or all projects */
export enum ProjectTypeFilter {
  Simulation = 'Simulation',
  Dataset = 'Dataset',
  Behavior = 'Behavior',
  All = 'All'
}

export enum UserSortOption {
  CreatedAt = 'createdAt',
  LastLogin = 'lastLogin',
  ProjectCount = 'projectCount',
  Role = 'role'
}

export enum SortDirection {
  Asc = 'Asc',
  Desc = 'Desc'
}

export type UsersResult = {
  totalCount: Scalars['Int'];
  users: Array<User>;
  page: Scalars['Int'];
  sort: UserSortOption;
  sortDirection: SortDirection;
  filter?: Maybe<Scalars['String']>;
};

/** An enum of possible source types. */
export enum SourceTypeName {
  Mapbox = 'mapbox',
  Bigquery = 'bigquery',
  Mongodb = 'mongodb',
  Snowflake = 'snowflake',
  Elasticsearch = 'elasticsearch',
  S3 = 's3'
}

/**
 * An integration for connecting to other data sources and APIs.
 * Consists of _exactly one_ source configuration (host, port, database, etc) and _exactly one_ credential.
 * Can be owned by either a user or an organization.
 * If owned by an organization, only an admin can modify it, but any member of the organization can access it.
 */
export type Integration = {
  /** The ObjectId of the integration in MongoDB. */
  id: Scalars['ID'];
  /** The user-defined name of the integration. Any given owner-name-type combination must be unique. */
  name: Scalars['String'];
  /** The type of source that this is an integration for. Currently only Mapbox. Later BigQuery, Snowflake etc. */
  type: SourceTypeName;
  /** The ObjectId of the attached credential for this integration. */
  credentialId: Scalars['String'];
  /** The ObjectId of the owner of this integration. */
  ownerId: Scalars['ID'];
  /** The owner itself -- either a user or an organization. Could theoretically be a simulation project itself in the future. */
  owner?: Maybe<UserOrOrg>;
  /**
   * Authorization information for this credential. Only relevant to the availableIntegrations endpoint,
   * where it contains information about when and how a user gave authorization for an integration to be used in a project.
   */
  authorization?: Maybe<Authorization>;
  /** Source configuration information for this integration. Hostnames, databases, etc. */
  source: SubSource;
};

/** An authorization for an integration to be used by a project. */
export type Authorization = {
  /** When the authorization was initially granted. */
  grantedAt: Scalars['Date'];
  /** The user that initially granted the authorization. */
  grantedBy: Scalars['ID'];
  /**
   * A map of user IDs to: {
   *   date: Date!
   *   asName: String!
   * }
   * To be used for finding the authorized integration the user is currently using for simulation runs.
   * i.e., for a given user/project/required-integration-name combination, whichever authorization was used most
   * recently is the one the user is using. Hit the permitIntegration endpoint to update a
   * combination to the most recently used.
   */
  lastAuthorized?: Maybe<Scalars['JSONObject']>;
};

/** Source configuration information for an integration of a specific type. */
export type SubSource = {
  /** The ID of the source.  */
  id: Scalars['ID'];
  /** A user-defined nickname for the source. Any given owner-name-type combination must be unique. */
  name: Scalars['String'];
  /** The type of configuration. Currently only mapbox. */
  type: SourceTypeName;
  /** The ID of the owner of this source. */
  ownerId: Scalars['ID'];
  /** The owner itself. An organization or user.  */
  owner: UserOrOrg;
  /** The type-specific source information.  */
  configuration: SourceType;
  /** A list of the types of credentials that are compatible with this source. */
  allowedCredentials: Array<CredentialType>;
};

/** A union of all possible configuration types. */
export type SourceType = Mapbox | BigQuery | MongoDb | Snowflake | ElasticSearch | S3 | Unknown;

/** Configuration information for Mapbox. */
export type Mapbox = {
  baseUrl?: Maybe<Scalars['String']>;
};

/** Configuration information for Google BigQuery. */
export type BigQuery = {
  /**
   * The base URL to query against. Example: https://bigquery.googleapis.com/bigquery/v1/projects/some-project-id/queries
   * If not specified, will be literally https://bigquery.googleapis.com/bigquery/v1/projects/$projectId/queries.
   */
  url?: Maybe<Scalars['String']>;
  /** The ID of the _Google Cloud_ project (no relation to HASH project IDs). */
  projectId: Scalars['String'];
  /** The ID of the _Google Cloud_ dataset that will be queried. */
  datasetId: Scalars['String'];
  /**
   * Optional. If not specified here, must be specified in the transformation that uses it.
   * Some valid SQL statement to use when querying the dataset.
   * Should be in a format that runs successfully in Google's query editor. Example:
   * "#standardSQL\nSELECT\n  growth.country_name,\n  growth.net_migration,\n
   * CAST(area.country_area AS INT64) AS country_area\nFROM (\n  SELECT\n
   * country_name,\n    net_migration,\n    country_code\n  FROM\n
   * `bigquery-public-data.census_bureau_international.birth_death_growth_rates`\n
   * WHERE\n    year = 2020) growth\nINNER JOIN (\n  SELECT\n    country_area,\n
   * country_code\n  FROM\n
   * `bigquery-public-data.census_bureau_international.country_names_area`)
   * area\nON\n  growth.country_code = area.country_code\nORDER BY\n  net_migration DESC",
   */
  query?: Maybe<Scalars['String']>;
  /**
   * Optional. If not specified here, must be specified in the transformation that uses it.
   * Whether the query is using Legacy SQL features. Almost invariably false, and the user will likely know if it isn't.
   */
  useLegacySql?: Maybe<Scalars['Boolean']>;
};

/** Configuration information for MongoDB. */
export type MongoDb = {
  /** Base database configuration information (host, port, et cetera). */
  store: Datastore;
  /** Optional. The name of the replica set. */
  replicaSet?: Maybe<Scalars['String']>;
  /** Optional. The name of the authentication database. Defaults to admin or $external depending on linked credentials. */
  authenticationDatabase?: Maybe<Scalars['String']>;
  /** Optional. The authentication mechanism to use. Default depends on linked credentials. */
  authenticationMechanism?: Maybe<Scalars['String']>;
};

/** Composition-over-inheritance type for common configuration fields for databases. */
export type Datastore = {
  /** The host and port of the server(s) to connect to. */
  servers: Array<Server>;
  /** The name of the database to connect to. */
  database: Scalars['String'];
  /** Connection string options for this specific connection. Example: timezone=UTC&batchInsert=False */
  options?: Maybe<Scalars['String']>;
  /** Optional. Version of the database software. Defaults to latest version. Ex: 7.11.0 */
  version?: Maybe<Scalars['String']>;
};

/** An individual server for an integration. */
export type Server = {
  /** The host uri. Examples: 127.0.0.1 or https://localhost or mymongoserver.example.com. */
  host: Scalars['String'];
  /** The port.  */
  port: Scalars['Int'];
};

/** Configuration information for Snowflake. */
export type Snowflake = {
  /**
   * The Snowflake account name. Example: if the Snowflake URL for the user is mycompany.snowflakecomputing.com,
   * the value here would just be 'mycompany'.
   */
  accountName: Scalars['String'];
  /** The warehouse name. */
  warehouse: Scalars['String'];
  /** The database name. */
  database: Scalars['String'];
  /** The name of the schema. This is the schema as understood by Snowflake, and is not related to HASH schemas. */
  schema: Scalars['String'];
  /**
   * Optional. If not specified here, must be specified in the transformation that uses it.
   * Some valid SQL statement to use when querying the store.
   */
  query?: Maybe<Scalars['String']>;
  /** Optional. The role to use. */
  role?: Maybe<Scalars['String']>;
};

/** Configuration information for ElasticSearch. */
export type ElasticSearch = {
  /** Optional. Version of the database software. Defaults to latest version. Ex: 7.11.0 */
  version?: Maybe<Scalars['String']>;
  /** Optional. The name of the index to query against. */
  indexName?: Maybe<Scalars['String']>;
  /**
   * Optional. If not specified here, must be specified in the transformation that uses it.
   * The query JSON to run. Example: "{"query":{"match_all":{}}}"
   */
  query?: Maybe<Scalars['String']>;
  /** Server information for the elasticsearch cluster.  */
  server: Server;
};

/** Configuration information for an S3 bucket. */
export type S3 = {
  /** The name of the bucket. */
  bucket: Scalars['String'];
  /**
   * The object key or object key pattern. Example: if the S3 URI is
   * s3://hash-terraform-state-s3-backend/base/terraform.tfstate,
   * the key is "base/terraform.tfstate", and a matching pattern could be "base/*.tfstate".
   */
  key: Scalars['String'];
  /** The AWS region the bucket is located in. Example: us-east-1. */
  region: Scalars['String'];
  /** The format of the source file. */
  format: FileFormat;
};

/** An enum of possible file types in S3 (or in the future other object storage services) */
export enum FileFormat {
  Csv = 'csv',
  Json = 'json',
  Parquet = 'parquet'
}

/** A type that could not be determined. */
export type Unknown = {
  unknown?: Maybe<Scalars['String']>;
};

/** An enum of the names of all accepted secret types. */
export enum CredentialType {
  Token = 'token',
  Googleserviceaccount = 'googleserviceaccount',
  Userpass = 'userpass',
  Ldap = 'ldap',
  Kerberos = 'kerberos',
  X509 = 'x509',
  Aws = 'aws'
}

/** An integration including the secret itself of the linked credential. Only accessible through the integration endpoint. */
export type FullIntegration = {
  /** The ObjectId of the integration in MongoDB. */
  id: Scalars['ID'];
  /** The user-defined name of the integration. Any given owner-name-type combination must be unique. */
  name: Scalars['String'];
  /** The type of source that this is an integration for. Currently only Mapbox. Later BigQuery, Snowflake etc. */
  type: SourceTypeName;
  /** The ObjectId of the attached credential for this integration. */
  credentialId?: Maybe<Scalars['String']>;
  /** The credential itself. This _WILL_ contain the secret itself if requested by an authorized entity. (!) */
  credential?: Maybe<Credential>;
  /** The ObjectId of the owner of this integration. */
  ownerId: Scalars['ID'];
  /** The owner itself -- either a user or an organization. Could theoretically be a simulation project itself in the future. */
  owner?: Maybe<UserOrOrg>;
  /**
   * Authorization information for this credential. Currently only relevant to the availableIntegrations endpoint,
   * where it contains information about when and how a user gave authorization for an integration to be used in a project.
   */
  authorization?: Maybe<Authorization>;
  /** Source configuration information for this integration. Hostnames, databases, etc. */
  source: SubSource;
};

/** A credential for accessing an integration. */
export type Credential = {
  /** User-defined name of the credential. Any given pair of owner ID and name must be unique. */
  name: Scalars['String'];
  /** The type of credential to store. Currently only supports persistent tokens. Later GCP credentials, keytabs, etc. */
  type: CredentialType;
  /** The credential itself. Currently only supports persistent tokens. Later GCP credentials, keytabs, etc. */
  secret: SecretType;
  /** The ID of the owning entity -- either a User or an Organization. */
  ownerId: Scalars['ID'];
  /** When the credential was created. */
  createdAt: Scalars['Date'];
  /** When the credential was last updated. */
  updatedAt: Scalars['Date'];
  /** The user that last altered the credential. */
  updatedBy: Scalars['ID'];
};

/** A union type for all accepted secret types. */
export type SecretType = Token | GoogleServiceAccount | UserPass | Ldap | Kerberos | Aws | X509;

/** A secret type for persistent (non-expiring) tokens. */
export type Token = {
  /** A string of the token itself. */
  accessToken: Scalars['String'];
};

/**
 * A resolved secret type for Google Cloud service account credentials.
 * The key names differ from the conventional format because they are aligned with those of GCP.
 */
export type GoogleServiceAccount = {
  /** The type of account. Must be "service_account". */
  type: Scalars['String'];
  /** The project ID. Typically matches the project ID of the source it is used with. */
  project_id: Scalars['String'];
  /** The ID of the private key for the account. */
  private_key_id: Scalars['String'];
  /** The private key itself. */
  private_key: Scalars['String'];
  /** The email address associated with the service account. */
  client_email: Scalars['String'];
  /** The ID of the client. */
  client_id: Scalars['String'];
  /** The URI of the authentication endpoint. */
  auth_uri: Scalars['String'];
  /** The URI of the token endpoint. */
  token_uri: Scalars['String'];
  /** The endpoint for x509 certification. */
  auth_provider_x509_cert_url: Scalars['String'];
  /** The client x509 certification url. */
  client_x509_cert_url: Scalars['String'];
};

/** A static username and password. */
export type UserPass = {
  /** The username. */
  username: Scalars['String'];
  /** The password. */
  password: Scalars['String'];
};

/**
 * LDAP authentication information. Depending on configuration, the username may be of a
 * templated format like alice@place.example.com, or the literal distinguished name
 * of a format like cn=admin,dc=example,dc=com
 */
export type Ldap = {
  /** The username. */
  username: Scalars['String'];
  /** Optional. The password. */
  password?: Maybe<Scalars['String']>;
  /** The full distinguished name. Example: 'CN=Jeff Smith,OU=Sales,DC=Fabrikam,DC=COM' */
  distinguishedName: Scalars['String'];
};

/** Kerberos authentication information. */
export type Kerberos = {
  /** The name of the realm. Example: UPENN.EDU */
  realm: Scalars['String'];
  /** The location of the kdc server(s). Example: ["kerberos1.upenn.edu", "kerberos2.upenn.edu", "kerberos3.upenn.edu"] */
  kdcAddresses: Array<Scalars['String']>;
  /** The fully qualified principal name. Example: bob@UPENN.EDU */
  principal: Scalars['String'];
  /** The serialized keytab file and/or password for this principal. */
  userKey: Scalars['String'];
};

/**
 * AWS authentication information. This is the _only_ accepted way to use AWS authorization.
 * See: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html
 */
export type Aws = {
  /**
   * A unique ID generated by the user to be used as a password/key when assuming the IAM role.
   * See https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html for more information.
   * This should be generated in-browser with instructions/links for the user to follow to set this up.
   * This key will never be shown to the user again, so warn them to properly set it up first.
   */
  externalId: Scalars['String'];
  /** The Amazon Resource Name of the role to use. This role must have access to whatever resources it needs. */
  roleArn: Scalars['String'];
  /** Whether to include a temporary session token in requests. */
  useSessionToken: Scalars['Boolean'];
};

/**
 * X.509 (TLS and/or SSL) authentication information. This is for the fairly niche case where the source requires
 * HTTPS communication, but is using its own self-signing certificate authority.
 */
export type X509 = {
  /** The x.509 PEM file for the client to use. */
  certificateKeyFilePem: Scalars['Upload'];
  /** The Certificate Authority file to trust, that signed both the client and the target instance's certificates. */
  certificateAuthorityFile: Scalars['Upload'];
};


/** The full resolved integration for a project. */
export type ResolvedIntegration = {
  /** The shortname of the integration referred to in the project. */
  name: Scalars['String'];
  /** The integration itself. */
  integration: FullIntegration;
};

/** The mutation operations available in this schema */
export type Mutation = {
  /** [DEPRECATED] Register an occurence of an event */
  registerEvent?: Maybe<Scalars['Boolean']>;
  /** Register an occurence of events */
  registerEvents?: Maybe<Scalars['Boolean']>;
  /** Clear all cached data */
  clearCache?: Maybe<Scalars['Boolean']>;
  snapshot: Scalars['Boolean'];
  /** Promote a version to production */
  promoteToLive?: Maybe<Scalars['Boolean']>;
  /** Delete an existing credential. */
  deleteCredential: Scalars['Boolean'];
  /** Create an entry in the database for the dataset and request a signed URL for uploading the file */
  addDataset: DatasetInit;
  /** Update the dataset's metadata */
  updateDataset?: Maybe<Dataset>;
  /** Add a dataset to a project. */
  addDatasetToProject: Project;
  /** Remove a dataset from a project */
  removeDatasetFromProject: Project;
  /** Update the name of a dataset in a project */
  updateDatasetName: Project;
  /** Publish a dataset from the dataset approval queue (admin only) */
  publishDataset?: Maybe<ScrapedDataset>;
  /** Ignore or un-ignore a scraped dataset (for approval queue filtering) */
  setDatasetStatus?: Maybe<ScrapedDataset>;
  /**
   * Internal and system accounts only -- link and release an already persisted dataset.
   * Includes discovered schema only if it has changed.
   */
  addAndReleaseDataset: UpdateAndReleaseReturn;
  /** Create a discussion note on a 'noteable' (e.g. an issue or merge request) */
  createDiscussion: NoteableType;
  /** Add a reply to a discussion thread */
  createDiscussionReply: Discussion;
  /** Edit a note/comment */
  editNote: Note;
  /** Resolve or unresolve an entire discussion thread */
  updateDiscussionStatus: Discussion;
  /** Awards an emoji to a note */
  awardEmojiToNote: Note;
  /** Removes an emoji from a note */
  removeEmojiFromNote: Note;
  /** Awards an emoji to an item that can receive comments (e.g. a merge request issue) */
  awardEmojiToNoteable: NoteableType;
  /** Remove an emoji from an item that can receive comments (e.g. a merge request issue) */
  removeEmojiFromNoteable: NoteableType;
  /**
   * Creates an ExperimentRun with a name - looks up the experiment name from the repo's experiments.json, and then:
   *   (1) for each necessary run in the experiment, applies the changed properties to the
   *  Simulation repository in a new commit
   *   (2) constructs an s3 folder to save the output of the SimulationRun to.
   *     format: [userId]/[experimentRunId]/[simulationRunId]
   *
   * Each SimulationRun has an s3Key indicating where its data is/should be saved.
   *
   * s3 Bucket: hash-experiments
   *
   * A single SimulationRun experiment using an exact copy of the referenced
   * simulation can be created by passing singleRun: true
   */
  createExperimentRun: ExperimentRunInitialData;
  createSimulationRun: SimulationRunInitialData;
  /**
   * Report cloud compute usage for an ExperimentRun. Multiple reports may be made
   * to update the usage count, until the report is finalised
   */
  reportComputeUsage: ExperimentRun;
  /** Provide a name for a experiment run */
  updateExperimentRun: ExperimentRun;
  /** Provide a name or the outcome for a simulation run */
  updateSimulationRun: SimulationRun;
  /**
   * Deletes an experiment run and each simulation run within it, including the
   * stored output and the immutable simulation variants used in the experiment.
   * Does not delete the original simulation that the experiment was called from.
   */
  deleteExperimentRun?: Maybe<Scalars['Boolean']>;
  /**
   * Deletes a simulation run, including the stored output and the immutable
   * simulation variant used to produce the run. Does not delete the original
   * simulatiton the experiment was based on, nor other simulation runs in the same
   * experiment. Returns the updated ExperimentRun without the deleted SimulationRun.
   */
  deleteSimulationRun: ExperimentRun;
  /** Set computeUsageRemaining for a user */
  setComputeUsage?: Maybe<Scalars['Boolean']>;
  /** Create an issue on a project */
  createIssue: Issue;
  /** Edit a project issue */
  editIssue: Issue;
  /** Create an merge request */
  createMergeRequest: MergeRequest;
  /** Edit a project merge request */
  editMergeRequest: MergeRequest;
  /** Accept a merge request and merges its changes in */
  acceptMergeRequest: MergeRequest;
  /** Adds git conflicts as a separate commit to be resolved in hCore */
  commitConflictsToMergeRequest: MergeRequest;
  /** Add an organization, under a 'data' key, as an object following the shape defined by type OrgInput */
  addOrg?: Maybe<Org>;
  /**
   * Update a specific organization, identified by the ID provided under the 'id'
   * key, with the fields to be added or updated under 'data'
   */
  updateOrg?: Maybe<Org>;
  /**
   * Delete a specific organization, identified by the ID provided under the
   * 'orgId' key. User be an admin of the organization Returns true if successful.
   */
  deleteOrg?: Maybe<Scalars['Boolean']>;
  /** Adds a user to an organization. */
  addUserToOrg?: Maybe<Scalars['Boolean']>;
  /** Removes a user from an organization. */
  removeUserFromOrg?: Maybe<Org>;
  /** Remove yourself from an organization. */
  removeMeFromOrg?: Maybe<Org>;
  /** Update your job title in an organiization */
  updateMyJobTitle?: Maybe<Org>;
  /** Update a user's role in an organization. */
  updateUserOrgRole?: Maybe<Org>;
  /** Create a new project. Defaults to creating it in the current user's namespace if no other namespace is provided. */
  createProject: Project;
  /** Create a commit in a project's repository */
  createCommit: CreateCommitReturn;
  /** Creates a release of the project */
  createRelease: ReleaseBasic;
  /** Deletes a project */
  deleteProject: Scalars['Boolean'];
  /** Fork a project into another namespace, optionally renaming it */
  forkProject: Project;
  /** Update a project's metadata */
  updateProject: Project;
  /**
   * Updates a project's metadata and then creates a release from the updated
   * project. A wrapper around the separate 'updateProject' and 'release'
   * mutations, guaranteeing update before release.
   */
  updateAndRelease: UpdateAndReleaseReturn;
  /**
   * Forks a project and then applies an update. A wrapper around the separate
   * 'forkProject' and 'updateProject' mutations. If the update fails, the fork
   * will be deleted
   */
  forkAndUpdate: Project;
  /**
   * Forks a project and then applies a commit. A wrapper around the separate
   * 'forkProject' and 'createCommit'. If the commit fails, the fork will be deleted.
   */
  forkAndCommit: ForkAndCommitReturn;
  /**
   * Forks a project, applies an update, and creates a release of the specified
   * behavior file(s) from it, followed by updating the original project to import
   * the newly released behavior(s) and delete the local copies. If any step fails,
   * the fork will be deleted.
   *
   * update.files must be provided, specifying the name and path of file(s) within
   * the repo to be exported as part of the release
   */
  forkAndReleaseBehavior: ForkAndReleaseBehaviorReturn;
  /** Star a project */
  starProject: StarReturn;
  /** Unstar a project */
  unstarProject: StarReturn;
  /** Request an access code for a private project. This may not always be unique. */
  requestPrivateProjectAccessCode: ProjectAccessCodeReturn;
  addGitHubScraper: GitHubScraper;
  /** Create a subject/type */
  createSubject: Subject;
  /** Copies a subject to another namespace */
  forkSubject: Subject;
  /** Updates a subject */
  updateSubject: Subject;
  /** Creates a property */
  createProperty: Property;
  /** Updates a property */
  updateProperty: Property;
  /** Delete an existing source. */
  deleteSource: Scalars['Boolean'];
  /** Add a user to the system */
  addUser?: Maybe<User>;
  /** Update a user's details (admins only) */
  updateUser?: Maybe<User>;
  deleteUser: Scalars['Boolean'];
  /** Update your details */
  updateMe: User;
  /** Obtain a client secret to use in registering a payment method */
  registerPaymentMethod: Scalars['String'];
  setDefaultPaymentMethod: User;
  sendLoginReminder: Scalars['Boolean'];
  /** Create or update an integration. */
  upsertIntegration?: Maybe<Integration>;
  /**
   * NOT IMPLEMENTED YET.
   *     TODO Requires CRUD operations on individual sources and credentials first.
   */
  integrate?: Maybe<Integration>;
  /**
   * Authorize a project to use a given integration.
   * This endpoint can be called repeatedly to update the latest authorized/used integrations for the project.
   */
  permitIntegration?: Maybe<Authorization>;
  /** Delete an existing integration. */
  deleteIntegration?: Maybe<Scalars['Boolean']>;
};


/** The mutation operations available in this schema */
export type MutationRegisterEventArgs = {
  action: EventAction;
  label?: Maybe<Scalars['String']>;
  context?: Maybe<Scalars['JSONObject']>;
};


/** The mutation operations available in this schema */
export type MutationRegisterEventsArgs = {
  actions: Array<AnalyticEvent>;
};


/** The mutation operations available in this schema */
export type MutationPromoteToLiveArgs = {
  stamp: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationDeleteCredentialArgs = {
  id: Scalars['ID'];
};


/** The mutation operations available in this schema */
export type MutationAddDatasetArgs = {
  data: DatasetCreationInput;
};


/** The mutation operations available in this schema */
export type MutationUpdateDatasetArgs = {
  id: Scalars['ID'];
  data: DatasetUpdateInput;
};


/** The mutation operations available in this schema */
export type MutationAddDatasetToProjectArgs = {
  id: Scalars['ID'];
  projectPath: Scalars['String'];
  rawCsv?: Maybe<Scalars['Boolean']>;
  exported?: Maybe<Scalars['Boolean']>;
};


/** The mutation operations available in this schema */
export type MutationRemoveDatasetFromProjectArgs = {
  filename: Scalars['String'];
  projectPath: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationUpdateDatasetNameArgs = {
  filename: Scalars['String'];
  projectPath: Scalars['String'];
  name: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationPublishDatasetArgs = {
  id: Scalars['ID'];
  data: DatasetPublishInput;
};


/** The mutation operations available in this schema */
export type MutationSetDatasetStatusArgs = {
  id: Scalars['ID'];
  ignored: Scalars['Boolean'];
};


/** The mutation operations available in this schema */
export type MutationAddAndReleaseDatasetArgs = {
  data: DatasetRelease;
  discoveredSchema?: Maybe<Scalars['JSONObject']>;
};


/** The mutation operations available in this schema */
export type MutationCreateDiscussionArgs = {
  projectPath: Scalars['String'];
  noteableIid: Scalars['Int'];
  noteableType: NoteableTypeName;
  body: Scalars['String'];
  state?: Maybe<StateEvent>;
};


/** The mutation operations available in this schema */
export type MutationCreateDiscussionReplyArgs = {
  projectPath: Scalars['String'];
  noteableIid: Scalars['Int'];
  noteableType: NoteableTypeName;
  discussionId: Scalars['String'];
  body: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationEditNoteArgs = {
  projectPath: Scalars['String'];
  noteableIid: Scalars['Int'];
  noteableType: NoteableTypeName;
  noteId: Scalars['Int'];
  body?: Maybe<Scalars['String']>;
  resolved?: Maybe<Scalars['Boolean']>;
};


/** The mutation operations available in this schema */
export type MutationUpdateDiscussionStatusArgs = {
  projectPath: Scalars['String'];
  mergeRequestId: Scalars['Int'];
  discussionId: Scalars['String'];
  resolved: Scalars['Boolean'];
};


/** The mutation operations available in this schema */
export type MutationAwardEmojiToNoteArgs = {
  projectPath: Scalars['String'];
  noteableIid: Scalars['Int'];
  noteableType: NoteableTypeName;
  noteId: Scalars['Int'];
  name: EmojiName;
};


/** The mutation operations available in this schema */
export type MutationRemoveEmojiFromNoteArgs = {
  projectPath: Scalars['String'];
  noteableIid: Scalars['Int'];
  noteableType: NoteableTypeName;
  noteId: Scalars['Int'];
  awardId: Scalars['Int'];
};


/** The mutation operations available in this schema */
export type MutationAwardEmojiToNoteableArgs = {
  projectPath: Scalars['String'];
  noteableIid: Scalars['Int'];
  noteableType: NoteableTypeName;
  name: EmojiName;
};


/** The mutation operations available in this schema */
export type MutationRemoveEmojiFromNoteableArgs = {
  projectPath: Scalars['String'];
  noteableIid: Scalars['Int'];
  noteableType: NoteableTypeName;
  awardId: Scalars['Int'];
};


/** The mutation operations available in this schema */
export type MutationCreateExperimentRunArgs = {
  name: Scalars['String'];
  projectPath: Scalars['String'];
  ref?: Maybe<Scalars['String']>;
  packageName?: Maybe<ExperimentPackageName>;
  createRuns?: Maybe<Scalars['Boolean']>;
  singleRun?: Maybe<Scalars['Boolean']>;
};


/** The mutation operations available in this schema */
export type MutationCreateSimulationRunArgs = {
  id: Scalars['ID'];
  propertyValues: Scalars['JSONObject'];
};


/** The mutation operations available in this schema */
export type MutationReportComputeUsageArgs = {
  id: Scalars['ID'];
  usage: Scalars['Int'];
  finalise?: Maybe<Scalars['Boolean']>;
};


/** The mutation operations available in this schema */
export type MutationUpdateExperimentRunArgs = {
  id: Scalars['ID'];
  name: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationUpdateSimulationRunArgs = {
  id: Scalars['ID'];
  name?: Maybe<Scalars['String']>;
  metricOutcome?: Maybe<Scalars['Float']>;
};


/** The mutation operations available in this schema */
export type MutationDeleteExperimentRunArgs = {
  id: Scalars['ID'];
};


/** The mutation operations available in this schema */
export type MutationDeleteSimulationRunArgs = {
  id: Scalars['ID'];
};


/** The mutation operations available in this schema */
export type MutationSetComputeUsageArgs = {
  shortname: Scalars['String'];
  amount: Scalars['Int'];
};


/** The mutation operations available in this schema */
export type MutationCreateIssueArgs = {
  projectPath: Scalars['String'];
  title: Scalars['String'];
  description: Scalars['String'];
  labels: Array<IssueLabel>;
};


/** The mutation operations available in this schema */
export type MutationEditIssueArgs = {
  projectPath: Scalars['String'];
  issueId: Scalars['Int'];
  description?: Maybe<Scalars['String']>;
  title?: Maybe<Scalars['String']>;
  labels?: Maybe<Array<IssueLabel>>;
  state?: Maybe<StateEvent>;
};


/** The mutation operations available in this schema */
export type MutationCreateMergeRequestArgs = {
  projectPath: Scalars['String'];
  sourcePath: Scalars['String'];
  title: Scalars['String'];
  description: Scalars['String'];
  labels?: Maybe<Array<MergeRequestLabel>>;
};


/** The mutation operations available in this schema */
export type MutationEditMergeRequestArgs = {
  projectPath: Scalars['String'];
  mergeRequestId: Scalars['Int'];
  description?: Maybe<Scalars['String']>;
  title?: Maybe<Scalars['String']>;
  labels?: Maybe<Array<MergeRequestLabel>>;
  state?: Maybe<StateEvent>;
};


/** The mutation operations available in this schema */
export type MutationAcceptMergeRequestArgs = {
  projectPath: Scalars['String'];
  mergeRequestId: Scalars['Int'];
  commitMessage?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationCommitConflictsToMergeRequestArgs = {
  projectPath: Scalars['String'];
  sourcePath: Scalars['String'];
  mergeRequestId: Scalars['Int'];
};


/** The mutation operations available in this schema */
export type MutationAddOrgArgs = {
  data: OrgInput;
  addCreator?: Maybe<Scalars['Boolean']>;
};


/** The mutation operations available in this schema */
export type MutationUpdateOrgArgs = {
  orgId: Scalars['ID'];
  data: OrgInput;
};


/** The mutation operations available in this schema */
export type MutationDeleteOrgArgs = {
  orgId: Scalars['ID'];
};


/** The mutation operations available in this schema */
export type MutationAddUserToOrgArgs = {
  orgId: Scalars['ID'];
  userId: Scalars['ID'];
  roleId?: Maybe<Scalars['ID']>;
  jobTitle?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationRemoveUserFromOrgArgs = {
  orgId: Scalars['ID'];
  userId: Scalars['ID'];
};


/** The mutation operations available in this schema */
export type MutationRemoveMeFromOrgArgs = {
  orgId: Scalars['ID'];
};


/** The mutation operations available in this schema */
export type MutationUpdateMyJobTitleArgs = {
  orgId: Scalars['ID'];
  jobTitle?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationUpdateUserOrgRoleArgs = {
  orgId: Scalars['ID'];
  userId: Scalars['ID'];
  roleId?: Maybe<Scalars['ID']>;
  jobTitle?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationCreateProjectArgs = {
  name: Scalars['String'];
  path: Scalars['String'];
  namespace?: Maybe<Scalars['String']>;
  type?: Maybe<ProjectTypeName>;
  visibility?: Maybe<VisibilityLevel>;
  description?: Maybe<Scalars['String']>;
  licenseId?: Maybe<Scalars['String']>;
  actions?: Maybe<Array<CommitAction>>;
  message?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationCreateCommitArgs = {
  projectPath: Scalars['String'];
  message: Scalars['String'];
  actions: Array<CommitAction>;
  accessCode?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationCreateReleaseArgs = {
  projectPath: Scalars['String'];
  tag: Scalars['String'];
  description?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationDeleteProjectArgs = {
  projectPath: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationForkProjectArgs = {
  projectPath: Scalars['String'];
  namespace?: Maybe<Scalars['String']>;
  path?: Maybe<Scalars['String']>;
  name?: Maybe<Scalars['String']>;
  ref?: Maybe<Scalars['String']>;
  asBehavior?: Maybe<Scalars['Boolean']>;
};


/** The mutation operations available in this schema */
export type MutationUpdateProjectArgs = {
  projectPath: Scalars['String'];
  data: ProjectUpdate;
  commitMessage?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationUpdateAndReleaseArgs = {
  projectPath: Scalars['String'];
  update: ProjectUpdate;
  commitMessage?: Maybe<Scalars['String']>;
  tag: Scalars['String'];
  description?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationForkAndUpdateArgs = {
  projectPath: Scalars['String'];
  namespace?: Maybe<Scalars['String']>;
  path?: Maybe<Scalars['String']>;
  name?: Maybe<Scalars['String']>;
  update: ProjectUpdate;
  commitMessage?: Maybe<Scalars['String']>;
  ref?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationForkAndCommitArgs = {
  projectPath: Scalars['String'];
  namespace?: Maybe<Scalars['String']>;
  path?: Maybe<Scalars['String']>;
  name?: Maybe<Scalars['String']>;
  commitMessage: Scalars['String'];
  actions: Array<CommitAction>;
  ref?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationForkAndReleaseBehaviorArgs = {
  projectPath: Scalars['String'];
  namespace?: Maybe<Scalars['String']>;
  path?: Maybe<Scalars['String']>;
  name?: Maybe<Scalars['String']>;
  update: ProjectUpdate;
  commitMessage?: Maybe<Scalars['String']>;
  tag: Scalars['String'];
  description?: Maybe<Scalars['String']>;
};


/** The mutation operations available in this schema */
export type MutationStarProjectArgs = {
  projectPath: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationUnstarProjectArgs = {
  projectPath: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationRequestPrivateProjectAccessCodeArgs = {
  projectPath: Scalars['String'];
  accessLevel: ProjectAccessCodeAccessType;
  unique?: Maybe<Scalars['Boolean']>;
};


/** The mutation operations available in this schema */
export type MutationAddGitHubScraperArgs = {
  data: GitHubScraperCreationData;
};


/** The mutation operations available in this schema */
export type MutationCreateSubjectArgs = {
  description: Scalars['String'];
  namespace: Scalars['String'];
  name: Scalars['String'];
  subTypeOf?: Maybe<Array<SchemaReferenceInput>>;
};


/** The mutation operations available in this schema */
export type MutationForkSubjectArgs = {
  namespace: Scalars['String'];
  name: Scalars['String'];
  version?: Maybe<Scalars['String']>;
  targetNamespace: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationUpdateSubjectArgs = {
  namespace: Scalars['String'];
  name: Scalars['String'];
  version?: Maybe<Scalars['String']>;
  description?: Maybe<Scalars['String']>;
  properties?: Maybe<Array<SchemaReferenceInput>>;
  subTypeOf?: Maybe<Array<SchemaReferenceInput>>;
};


/** The mutation operations available in this schema */
export type MutationCreatePropertyArgs = {
  description: Scalars['String'];
  name: Scalars['String'];
  namespace: Scalars['String'];
  expectedType: Array<SchemaReferenceInput>;
};


/** The mutation operations available in this schema */
export type MutationUpdatePropertyArgs = {
  namespace: Scalars['String'];
  name: Scalars['String'];
  description?: Maybe<Scalars['String']>;
  expectedType: Array<SchemaReferenceInput>;
  subPropertyOf?: Maybe<Array<SchemaReferenceInput>>;
  supersededBy?: Maybe<SchemaReferenceInput>;
  inverseOf?: Maybe<SchemaReferenceInput>;
};


/** The mutation operations available in this schema */
export type MutationDeleteSourceArgs = {
  id: Scalars['ID'];
};


/** The mutation operations available in this schema */
export type MutationAddUserArgs = {
  data: UserCreationInput;
};


/** The mutation operations available in this schema */
export type MutationUpdateUserArgs = {
  id: Scalars['ID'];
  data: UserUpdateInput;
};


/** The mutation operations available in this schema */
export type MutationDeleteUserArgs = {
  email: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationUpdateMeArgs = {
  data: UserUpdateInput;
};


/** The mutation operations available in this schema */
export type MutationSetDefaultPaymentMethodArgs = {
  id: Scalars['ID'];
};


/** The mutation operations available in this schema */
export type MutationSendLoginReminderArgs = {
  email: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationUpsertIntegrationArgs = {
  name: Scalars['String'];
  integrationType: SourceTypeName;
  credential?: Maybe<CredentialCreationInput>;
  ownerId?: Maybe<Scalars['ID']>;
  source: SourceCreationInput;
};


/** The mutation operations available in this schema */
export type MutationIntegrateArgs = {
  name: Scalars['String'];
  integrationType: SourceTypeName;
  credentialId: Scalars['ID'];
  sourceId: Scalars['ID'];
  ownerId?: Maybe<Scalars['ID']>;
};


/** The mutation operations available in this schema */
export type MutationPermitIntegrationArgs = {
  projectId: Scalars['ID'];
  integrationId: Scalars['ID'];
  asName: Scalars['String'];
};


/** The mutation operations available in this schema */
export type MutationDeleteIntegrationArgs = {
  id: Scalars['ID'];
  deleteSource?: Maybe<Scalars['Boolean']>;
  deleteCredentials?: Maybe<Scalars['Boolean']>;
};

export enum EventAction {
  RunSimulation = 'RunSimulation',
  OpenSimulation = 'OpenSimulation',
  OpenProject = 'OpenProject',
  ExperimentRun = 'ExperimentRun',
  ExperimentSimulationRun = 'ExperimentSimulationRun'
}

export type AnalyticEvent = {
  /** The name of the action taken */
  action: EventAction;
  /** A label for the event */
  label?: Maybe<Scalars['String']>;
  /** Any additional context about the event */
  context?: Maybe<Scalars['JSONObject']>;
};

export type DatasetCreationInput = {
  /** A friendly name for the dataset */
  name: Scalars['String'];
  /** The filename to be used when the dataset itself is uploaded */
  filename: Scalars['String'];
  /** The full path of the project the dataset is being assigned to */
  projectPath: Scalars['String'];
};

export type DatasetInit = {
  /** The details the client needs to be able to upload a file */
  postForm?: Maybe<SignedPostForm>;
  /** The metadata held in the database on the dataset */
  dataset?: Maybe<Dataset>;
};

/** Information required to upload a file using a temporary security policy */
export type SignedPostForm = {
  /** The signed URL to be used for uploading the file */
  url: Scalars['String'];
  /** The fields the client must attach to the form to be submitted, with the file to upload appended last under 'file' */
  fields?: Maybe<Scalars['JSONObject']>;
};

export type DatasetUpdateInput = {
  /** A friendly name for the dataset */
  name?: Maybe<Scalars['String']>;
  /** A description, instructions or notes on the dataset */
  description?: Maybe<Scalars['String']>;
};

export type DatasetPublishInput = {
  /** The title of the dataset */
  title: Scalars['String'];
  /** A description, instructions or notes on the dataset */
  description: Scalars['String'];
  /** A shortname unique among the publisher's listings */
  shortname: Scalars['String'];
  /** The actual file(s) to be made available under the listing */
  resources: Array<DatasetResourceInput>;
  /** The id of the publisher of the dataset */
  existingPublisherId?: Maybe<Scalars['ID']>;
  /** Details of an organization to create as the dataset's publisher */
  newPublisher?: Maybe<PublisherCreationInput>;
  /** The id of the license the dataset is made available under */
  existingLicenseId?: Maybe<Scalars['ID']>;
  /** Details of a license to create and assign the dataset to */
  newLicense?: Maybe<LicenseCreationInput>;
  /** The id of the subject(s) of the dataset */
  existingSubjectIds?: Maybe<Array<Scalars['ID']>>;
  landingPage?: Maybe<Scalars['String']>;
  /** Additional reference information for the dataset */
  references?: Maybe<Array<Scalars['String']>>;
  version?: Maybe<Scalars['String']>;
  language?: Maybe<Array<Scalars['String']>>;
  /** How frequently the dataset is updated */
  updateFreq?: Maybe<Scalars['String']>;
  /** Keywords or tags associated with the dataset */
  keywords?: Maybe<Array<Scalars['String']>>;
  contactPoint?: Maybe<Scalars['String']>;
  contactPointEmail?: Maybe<Scalars['String']>;
  /** The period of time the dataset covers */
  temporalCoverage?: Maybe<Scalars['String']>;
  /** The frequency interval of the datapoints within the dataset */
  temporalFrequency?: Maybe<Scalars['String']>;
  /** The physical area covered by the dataset */
  spatialCoverage?: Maybe<Scalars['String']>;
  /** Additional information about the rights held or offered on the dataset */
  rights?: Maybe<Scalars['String']>;
  /** The name of a collection or group the dataset belongs to */
  isPartOf?: Maybe<Scalars['String']>;
  /** The International Standard Serial Number used to identify a serial publication */
  issn?: Maybe<Scalars['String']>;
  /** The technique(s) used to measure the data */
  measurementTechnique?: Maybe<Scalars['String']>;
  /** The specific variable the data measures */
  variableMeasured?: Maybe<Scalars['String']>;
  /** The name of the data catalog the resource is included in, if any */
  includedInDataCatalog?: Maybe<Scalars['String']>;
};

export type DatasetResourceInput = {
  /** The id of the resource as assigned in its source */
  id?: Maybe<Scalars['String']>;
  /** The name of the resource */
  name: Scalars['String'];
  /** The shortname of the resource, including extension */
  shortname: Scalars['String'];
  /** The revisionId in its source the resource was first made available under */
  revisionId?: Maybe<Scalars['String']>;
  /** The URL to the specific file being uploaded and made available */
  url: Scalars['String'];
  /** The file format of the resource, expressed as a mime-type */
  format: Scalars['String'];
  /** A description of the resource */
  description?: Maybe<Scalars['String']>;
  /** A URL to an explanation of the resource */
  describedBy?: Maybe<Scalars['String']>;
  /** The type of file which describes the resource */
  describedByType?: Maybe<Scalars['String']>;
  /** The size of the file */
  size?: Maybe<Scalars['Int']>;
  createdAt?: Maybe<Scalars['String']>;
  updatedAt?: Maybe<Scalars['String']>;
};

export type PublisherCreationInput = {
  name: Scalars['String'];
  logoUrl?: Maybe<Scalars['String']>;
  logoFile?: Maybe<Scalars['Upload']>;
};

export type LicenseCreationInput = {
  /** The name of the license */
  name: Scalars['String'];
  /** Additional description of the license */
  description?: Maybe<Scalars['String']>;
  /** A link to an explanation of the license's terms */
  url?: Maybe<Scalars['String']>;
  /** A link to a logo representing the license */
  logo?: Maybe<Scalars['String']>;
};

/** Input required for hFlow internal dataset creation. */
export type DatasetRelease = {
  /** The name of the dataset. */
  name: Scalars['String'];
  /** The filename alias to use. */
  filename: Scalars['String'];
  /** The project path in the format '@owner/project-name'. */
  projectPath: Scalars['String'];
  /** S3 location information. */
  s3Location: S3LocationInput;
  /** The message to add to the commit. */
  message: Scalars['String'];
  /** The size of all files (not the size of an individual file). */
  size: Scalars['Int'];
  /** The new version. */
  version: Scalars['String'];
};

export type S3LocationInput = {
  bucket: Scalars['String'];
  folder: Scalars['String'];
  files: Array<Scalars['String']>;
};

export type UpdateAndReleaseReturn = {
  project: Project;
  release: ReleaseBasic;
};

export enum StateEvent {
  Close = 'close',
  Reopen = 'reopen'
}

export type NoteableType = Issue | MergeRequest;

export type ExperimentRunInitialData = {
  experimentRun: ExperimentRun;
  computeUsageRemaining: Scalars['Int'];
};

export type SimulationRunInitialData = {
  id: Scalars['ID'];
  name: Scalars['String'];
  s3Key: Scalars['String'];
  stepsUploadForm: SignedPostForm;
  analysisUploadForm: SignedPostForm;
};

/** Inputs allowed when creating or updating an organization */
export type OrgInput = {
  /** The name for the organization */
  name?: Maybe<Scalars['String']>;
  /** Alternate name(s) the organization may be referred to as */
  alternateName?: Maybe<Array<Scalars['String']>>;
  /** A unique string identifying the organization in HASH (may only be updated after creation by admins) */
  shortname?: Maybe<Scalars['String']>;
  /** Free single-line text to specify organization location (see 'address' for postal address) */
  location?: Maybe<Scalars['String']>;
  /** The physical address(es) of the organization (see 'location' for a single line of free text) */
  address?: Maybe<Array<PostalAddressInput>>;
  /** A description of the organization */
  description?: Maybe<Scalars['String']>;
  /** The full legal name of the organization */
  legalName?: Maybe<Scalars['String']>;
  /** The parent organization of this organization */
  parentOrganization?: Maybe<Scalars['ID']>;
  /** Whether the organization is non-profit or not */
  nonProfit?: Maybe<Scalars['Boolean']>;
  /** Whether the organization's membership is made public or not */
  publicMembership?: Maybe<Scalars['Boolean']>;
  /** A way for HASH users to contact the organization with any questions */
  supportContact?: Maybe<Scalars['String']>;
  /** The organization's logo */
  logo?: Maybe<Scalars['Upload']>;
  /** A square image representing the organization */
  avatar?: Maybe<Scalars['Upload']>;
  /** Another image associated with the organization */
  image?: Maybe<Array<Scalars['String']>>;
  /** The organization's website */
  url?: Maybe<Array<Scalars['String']>>;
};

/** A physical address of an organization or entity */
export type PostalAddressInput = {
  /** The post office box number for PO box addresses. */
  postOfficeBoxNumber?: Maybe<Scalars['String']>;
  /** The street address. */
  streetAddress?: Maybe<Scalars['String']>;
  /** The locality in which the street address is (e.g. a town) */
  addressLocality?: Maybe<Scalars['String']>;
  /** The region (e.g. a state, county, or other top-level district in a country */
  addressRegion?: Maybe<Scalars['String']>;
  /** The country */
  addressCountry?: Maybe<Scalars['String']>;
  /** The postal code or zip code */
  postalCode?: Maybe<Scalars['String']>;
};

/** An action operating on a single file as part of a commit */
export type CommitAction = {
  /** The type of action to take */
  action: CommitActionVerb;
  /** The path of the file to operate on (or the new path, if being moved) */
  filePath: Scalars['String'];
  /** If a file is being moved, its previous path in the repository */
  previousPath?: Maybe<Scalars['String']>;
  /** If a file is being created or updated, its content */
  content?: Maybe<Scalars['String']>;
};

/** The types of action allowed on a file as part of a commit */
export enum CommitActionVerb {
  Create = 'create',
  Delete = 'delete',
  Move = 'move',
  Update = 'update'
}

export type CreateCommitReturn = {
  commit: Commit;
  project: Project;
};

export type ProjectUpdate = {
  /** A friendly name for the project */
  name?: Maybe<Scalars['String']>;
  /** A namespace to move the project into */
  namespace?: Maybe<Scalars['String']>;
  /** A short description of the project */
  description?: Maybe<Scalars['String']>;
  /** The files to export from the project in its releases (e.g. behaviors) */
  files?: Maybe<Array<ExportedFile>>;
  /** The level of access restriction on the project */
  visibility?: Maybe<VisibilityLevel>;
  /** Keywords / tags to help users locate the project */
  keywords?: Maybe<Array<Scalars['String']>>;
  /** The subjects of the project */
  subject?: Maybe<Array<SchemaReferenceInput>>;
  /** The id of the license the project is made available under */
  license?: Maybe<Scalars['String']>;
  /** Update the project type */
  type?: Maybe<ProjectTypeName>;
  /**
   * Details of a new license to create and assign for the listing. This license
   * will become available for future use by the publisher only
   */
  newLicense?: Maybe<LicenseCreationInput>;
  /** The period of time the project's dataset(s) covers */
  temporalCoverage?: Maybe<Scalars['String']>;
  /** The frequency interval of the datapoints of dataset(s) within the projcet */
  dataFrequency?: Maybe<Scalars['String']>;
  /** The physical area covered by dataset(s) in the project */
  spatialCoverage?: Maybe<Scalars['String']>;
  /** An image to display representing the listing */
  avatar?: Maybe<Scalars['Upload']>;
  /** A wide-ratio (1.91:1) cover image to promote and illustrate listings */
  image?: Maybe<Scalars['Upload']>;
};

export type ExportedFile = {
  /** The filename */
  filename: Scalars['String'];
  /** The path to the file within the repo */
  path: Scalars['String'];
};

export type SchemaReferenceInput = {
  name: Scalars['String'];
  namespace: Scalars['String'];
  version?: Maybe<Scalars['String']>;
};

export type ForkAndCommitReturn = {
  project: Project;
  commit: Commit;
};

export type ForkAndReleaseBehaviorReturn = {
  sourceProject: Project;
  behaviorProject: Project;
};

export type StarReturn = {
  project: Project;
  user: User;
};

/** The level of access that an access code grants */
export enum ProjectAccessCodeAccessType {
  Write = 'Write',
  Read = 'Read',
  ReadEmbed = 'ReadEmbed'
}

export type ProjectAccessCodeReturn = {
  code: ProjectAccessCode;
  unique: Scalars['Boolean'];
};

export type ProjectAccessCode = {
  code: Scalars['String'];
  accessLevel: ProjectAccessCodeAccessType;
  project: Project;
  creator: User;
  createdAt: Scalars['Date'];
  updatedAt: Scalars['Date'];
};

export type GitHubScraperCreationData = {
  description?: Maybe<Scalars['String']>;
  files: Array<GitHubScraperFileInput>;
  frequency: ScraperFrequency;
  /** The id of a predefined license to make the project available under. */
  licenseId?: Maybe<Scalars['String']>;
  /** A custom license to create a LICENSE.md file from */
  licenseText?: Maybe<Scalars['String']>;
  name: Scalars['String'];
  namespace: Scalars['String'];
  path: Scalars['String'];
  readme?: Maybe<Scalars['String']>;
  repoPath: Scalars['String'];
};

export type GitHubScraperFileInput = {
  fileDownloadUrl: Scalars['String'];
  filepathInRepo: Scalars['String'];
  filenameInHASH: Scalars['String'];
  nameInHASH?: Maybe<Scalars['String']>;
};

export type UserCreationInput = {
  additionalName?: Maybe<Array<Scalars['String']>>;
  biography?: Maybe<Scalars['String']>;
  email: Scalars['String'];
  familyName?: Maybe<Scalars['String']>;
  givenName?: Maybe<Scalars['String']>;
  image?: Maybe<Scalars['Upload']>;
  knowsLanguage?: Maybe<Array<Scalars['String']>>;
  location?: Maybe<Scalars['String']>;
  role?: Maybe<Scalars['ID']>;
  shortname: Scalars['String'];
  telephone?: Maybe<Scalars['String']>;
  url?: Maybe<Scalars['String']>;
};

export type UserUpdateInput = {
  givenName?: Maybe<Scalars['String']>;
  familyName?: Maybe<Scalars['String']>;
  /** Only admins may update shortnames after user creation */
  shortname?: Maybe<Scalars['String']>;
  biography?: Maybe<Scalars['String']>;
  knowsLanguage?: Maybe<Array<Scalars['String']>>;
  location?: Maybe<Scalars['String']>;
  url?: Maybe<Scalars['String']>;
  telephone?: Maybe<Scalars['String']>;
  image?: Maybe<Scalars['Upload']>;
  onboarded?: Maybe<Scalars['Boolean']>;
  tourProgress?: Maybe<TourProgressInput>;
  /** The ID of the role to assign a user (admins only) */
  role?: Maybe<Scalars['ID']>;
};

export type TourProgressInput = {
  completed: Scalars['Boolean'];
  version?: Maybe<Scalars['String']>;
  lastStepViewed?: Maybe<Scalars['String']>;
};

/** Required inputs for creating a new credential. */
export type CredentialCreationInput = {
  /** User-defined name of the credential. Any given pair of owner ID and name must be unique. */
  name: Scalars['String'];
  /** The type of credential to store. Currently token, googleserviceaccount, userpass, ldap, kerberos, x509, aws. */
  type: CredentialType;
  /**
   * Optional: the ID of the owning entity -- either a User or an Organization.
   * If not provided, the owner will be the user that created the credential.
   */
  ownerId?: Maybe<Scalars['ID']>;
  /**
   * A string of the secret token itself. Used for Token credentials.
   * Note: GraphQL does not currently support union types in inputs.
   * Check SecretType for what fields are necessary for the type of credential you are creating.
   */
  accessToken?: Maybe<Scalars['String']>;
  /** The Google Cloud service account JSON. A file. Will be of a format like that of the GoogleServiceAccount type. */
  serviceAccountJson?: Maybe<Scalars['Upload']>;
  /** Inputs required for username and password credentials. */
  userPass?: Maybe<UserPassInput>;
  /** Inputs required for LDAP credentials. */
  ldap?: Maybe<LdapInput>;
  /** Inputs required for AWS credentials. */
  aws?: Maybe<AwsInput>;
  /** Inputs required for Kerberos credentials. */
  kerberos?: Maybe<KerberosInput>;
  /** Inputs required for x.509 credentials. */
  x509?: Maybe<X509Input>;
};

/** An input type for UserPass credentials. */
export type UserPassInput = {
  /** The username. */
  username: Scalars['String'];
  /** The password. */
  password: Scalars['String'];
};

/**
 * An input type for LDAP credentials. This differs little from UserPass, but affects configurations for some
 * clients, e.g. MongoDB.
 */
export type LdapInput = {
  /** The username. */
  username: Scalars['String'];
  /** Optional. The password. */
  password?: Maybe<Scalars['String']>;
  /** The full distinguished name. Example: 'CN=Jeff Smith,OU=Sales,DC=Fabrikam,DC=COM' */
  distinguishedName: Scalars['String'];
};

/**
 * AWS authentication information. This is the _only_ accepted way to use AWS authorization.
 * See: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html
 */
export type AwsInput = {
  /**
   * A unique ID generated by the user to be used as a password/key when assuming the IAM role.
   * See https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html for more information.
   * This should be generated in-browser with instructions/links for the user to follow to set this up.
   * This key will never be shown to the user again, so warn them to properly set it up first.
   */
  externalId: Scalars['String'];
  /** The Amazon Resource Name of the role to use. This role must have access to whatever resources it needs. */
  roleArn: Scalars['String'];
  /** Whether to include a temporary session token in requests. */
  useSessionToken: Scalars['Boolean'];
};

/** Kerberos authentication information. */
export type KerberosInput = {
  /** The name of the realm. Example: UPENN.EDU */
  realm: Scalars['String'];
  /** The location of the kdc server(s). Example: ["kerberos1.upenn.edu", "kerberos2.upenn.edu", "kerberos3.upenn.edu"] */
  kdcAddresses: Array<Scalars['String']>;
  /** The fully qualified principal name. Example: bob@UPENN.EDU */
  principal: Scalars['String'];
  /** The serialized keytab file and/or password for this principal. */
  userKey: Scalars['String'];
};

/**
 * X.509 (TLS and/or SSL) authentication information. This is for the fairly niche case where the source requires
 * HTTPS communication, but using its own self-signing certificate authority.
 */
export type X509Input = {
  /** The x.509 PEM file for the client to use. */
  certificateKeyFilePem: Scalars['Upload'];
  /** The Certificate Authority file to trust, that signed both the client and the target instance's certificates. */
  certificateAuthorityFile: Scalars['Upload'];
};

/** Information required to create a new source. */
export type SourceCreationInput = {
  /** The name of the source. */
  name: Scalars['String'];
  /** The type of source to create. */
  type: SourceTypeName;
  /** The ID of the owner of the new source. If not provided, this will be the user that created it. */
  ownerId?: Maybe<Scalars['ID']>;
  /**
   * MapBox: The base URL for the integration.
   * Note: GraphQL does not currently support union types in inputs.
   * Check SourceType for what fields are necessary for the type of integration you are creating.
   */
  baseUrl?: Maybe<Scalars['String']>;
  /** Information to create a BigQuery source. */
  bigquery?: Maybe<BigQueryCreation>;
  /** Information to create a MongoDB and/or MongoDB Atlas source. */
  mongodb?: Maybe<MongoDbCreation>;
  /** Information to create a Snowflake source. */
  snowflake?: Maybe<SnowflakeCreation>;
  /** Information to create an ElasticSearch source. */
  elasticsearch?: Maybe<ElasticSearchCreation>;
  /** Information to create an S3 source. */
  s3?: Maybe<S3Creation>;
};

/** BigQuery source creation information. */
export type BigQueryCreation = {
  /**
   * The base URL to query against. Example: https://bigquery.googleapis.com/bigquery/v1/projects/some-project-id/queries
   * If not specified, will be literally https://bigquery.googleapis.com/bigquery/v1/projects/$projectId/queries.
   */
  url?: Maybe<Scalars['String']>;
  /** The ID of the _Google Cloud_ project (no relation to HASH project IDs). */
  projectId: Scalars['String'];
  /** The ID of the _Google Cloud_ dataset that will be queried. */
  datasetId: Scalars['String'];
  /**
   * Optional. If not specified here, must be specified in the transformation that uses it.
   * Some valid SQL statement to use when querying the dataset.
   * Should be in a format that runs successfully in Google's query editor. Example:
   * "#standardSQL\nSELECT\n  growth.country_name,\n  growth.net_migration,\n
   * CAST(area.country_area AS INT64) AS country_area\nFROM (\n  SELECT\n
   * country_name,\n    net_migration,\n    country_code\n  FROM\n
   * `bigquery-public-data.census_bureau_international.birth_death_growth_rates`\n
   * WHERE\n    year = 2020) growth\nINNER JOIN (\n  SELECT\n    country_area,\n
   * country_code\n  FROM\n
   * `bigquery-public-data.census_bureau_international.country_names_area`)
   * area\nON\n  growth.country_code = area.country_code\nORDER BY\n  net_migration DESC",
   */
  query?: Maybe<Scalars['String']>;
  /**
   * Optional. If not specified here, must be specified in the transformation that uses it.
   * Whether the query is using Legacy SQL features. Almost invariably false, and the user will likely know if it isn't.
   */
  useLegacySql?: Maybe<Scalars['Boolean']>;
};

/** MongoDB and/or MongoDB Atlas source creation information. */
export type MongoDbCreation = {
  /** Base database configuration information (host, port, et cetera). */
  store: DatastoreInput;
  /** Optional. The name of the replica set. */
  replicaSet?: Maybe<Scalars['String']>;
  /** Optional. The name of the authentication database. Defaults to admin or $external depending on linked credentials. */
  authenticationDatabase?: Maybe<Scalars['String']>;
  /** Optional. The authentication mechanism to use. Default depends on linked credentials. */
  authenticationMechanism?: Maybe<Scalars['String']>;
};

/** Composition-over-inheritance type for common configuration fields for databases, but an input type! */
export type DatastoreInput = {
  /** The host and port of the server(s) to connect to. */
  servers: Array<ServerInput>;
  /** The name of the database to connect to. */
  database: Scalars['String'];
  /** Connection string options for this specific connection. Example: timezone=UTC&batchInsert=False */
  options?: Maybe<Scalars['String']>;
  /** Optional. Version of the database software. Defaults to latest version. Ex: 7.11.0 */
  version?: Maybe<Scalars['String']>;
};

/** An individual server for an integration, but an input type. */
export type ServerInput = {
  /** The host uri. Examples: 127.0.0.1 or https://localhost or mymongoserver.example.com. */
  host: Scalars['String'];
  /** The port.  */
  port: Scalars['Int'];
};

/** Snowflake source information. */
export type SnowflakeCreation = {
  /**
   * The Snowflake account name. Example: if the Snowflake URL for the user is mycompany.snowflakecomputing.com,
   * the value here would just be 'mycompany'.
   */
  accountName: Scalars['String'];
  /** The warehouse name. */
  warehouse: Scalars['String'];
  /** The database name. */
  database: Scalars['String'];
  /** The name of the schema. This is the schema as understood by Snowflake, and is not related to HASH schemas. */
  schema: Scalars['String'];
  /**
   * Optional. If not specified here, must be specified in the transformation that uses it.
   * Some valid SQL statement to use when querying the store.
   */
  query?: Maybe<Scalars['String']>;
  /** Optional. The role to use. */
  role?: Maybe<Scalars['String']>;
};

/** Input information for ElasticSearch. */
export type ElasticSearchCreation = {
  /** Optional. Version of the database software. Defaults to latest version. Ex: 7.11.0 */
  version?: Maybe<Scalars['String']>;
  /** Optional. The name of the index to query against. */
  indexName?: Maybe<Scalars['String']>;
  /**
   * Optional. If not specified here, must be specified in the transformation that uses it.
   * The query JSON to run. Example: "{"query":{"match_all":{}}}"
   */
  query?: Maybe<Scalars['String']>;
  /** Server information for the elasticsearch cluster.  */
  server: ServerInput;
};

/** Input information for an S3 bucket. */
export type S3Creation = {
  /** The name of the bucket. */
  bucket: Scalars['String'];
  /**
   * The object key or object key pattern. Example: if the S3 URI is
   * s3://hash-terraform-state-s3-backend/base/terraform.tfstate,
   * the key is "base/terraform.tfstate", and a matching pattern could be "base/*.tfstate".
   */
  key: Scalars['String'];
  /** The AWS region the bucket is located in. Example: us-east-1. */
  region: Scalars['String'];
  /** The format of the source file. */
  format: FileFormat;
};

export type File = {
  filename: Scalars['String'];
  mimetype: Scalars['String'];
  encoding: Scalars['String'];
};

export type FileFormatCount = {
  name?: Maybe<Scalars['String']>;
  count?: Maybe<Scalars['Int']>;
};

/**
 * A list of all integrations available to a user,
 * OR
 * A list of all integrations authorized for a project for a given user
 *   IF it is part of a Project response, or a projectId was given in the request.
 */
export type AvailableIntegrations = {
  integrations: Array<Integration>;
};

/**
 * NOT IMPLEMENTED YET.
 *     TODO Requires CRUD operations on individual sources and credentials first.
 *     Purpose is to enable sources without credentials and vice versa to be added at the organization level,
 *     and for sources to be tied directly to projects without credentials.
 */
export type IntegrateInput = {
  name: Scalars['String'];
  integrationType: SourceTypeName;
  credentialId: Scalars['ID'];
  sourceId: Scalars['ID'];
  ownerId?: Maybe<Scalars['ID']>;
};

export type AddDatasetToProjectMutationVariables = Exact<{
  id: Scalars['ID'];
  projectPath: Scalars['String'];
  csv: Scalars['Boolean'];
}>;


export type AddDatasetToProjectMutation = { addDatasetToProject: (
    Pick<Project, 'id'>
    & { files: Array<Pick<ProjectFile, 'contents' | 'name' | 'path'>> }
  ) };

export type BasicUserFragmentFragment = Pick<User, 'id' | 'email' | 'fullName' | 'shortname' | 'staffMember'>;

export type CanUserEditProjectQueryVariables = Exact<{
  pathWithNamespace: Scalars['String'];
  ref: Scalars['String'];
}>;


export type CanUserEditProjectQuery = { project: (
    Pick<Project, 'canUserEdit'>
    & { dependencies: Array<Pick<Release, 'pathWithNamespace' | 'canUserEdit'>> }
  ) };

export type CommitActionsMutationVariables = Exact<{
  pathWithNamespace: Scalars['String'];
  actions: Array<CommitAction> | CommitAction;
  message: Scalars['String'];
  includeFullProject: Scalars['Boolean'];
  accessCode?: Maybe<Scalars['String']>;
}>;


export type CommitActionsMutation = { createCommit: { project?: Maybe<(
      Pick<Project, 'updatedAt'>
      & FullProjectFragmentFragment
    )>, commit: Pick<Commit, 'id' | 'message' | 'createdAt'> } };

export type ExampleProjectsFragmentFragment = { specialProjects: Array<PartialProjectFragmentFragment> };

export type ForkAndReleaseBehaviorsMutationVariables = Exact<{
  projectPath: Scalars['String'];
  name: Scalars['String'];
  namespace?: Maybe<Scalars['String']>;
  path: Scalars['String'];
  commitMessage: Scalars['String'];
  tag: Scalars['String'];
  releaseDescription: Scalars['String'];
  files: Array<ExportedFile> | ExportedFile;
  projectDescription: Scalars['String'];
  visibility: VisibilityLevel;
  license: Scalars['String'];
  keywords: Array<Scalars['String']> | Scalars['String'];
}>;


export type ForkAndReleaseBehaviorsMutation = { forkAndReleaseBehavior: { sourceProject: (
      Pick<Project, 'updatedAt'>
      & FilesFragmentFragment
    ), behaviorProject: Pick<Project, 'pathWithNamespace' | 'ref'> } };

export type UserProjectsFragmentFragment = { projects: { results: Array<PartialProjectFragmentFragment> } };

export type MyProjectsQueryVariables = Exact<{ [key: string]: never; }>;


export type MyProjectsQuery = { me?: Maybe<UserProjectsFragmentFragment> };

export type PartialProjectFragmentFragment = (
  Pick<Project, 'pathWithNamespace' | 'name' | 'updatedAt' | 'type' | 'visibility'>
  & { latestRelease?: Maybe<Pick<ReleaseBasic, 'createdAt' | 'tag'>>, forkOf?: Maybe<Pick<ForkOfProject, 'pathWithNamespace'>> }
);

export type PartialProjectByPathQueryVariables = Exact<{
  pathWithNamespace: Scalars['String'];
  version: Scalars['String'];
}>;


export type PartialProjectByPathQuery = { project: PartialProjectFragmentFragment };

export type ProjectHistoryQueryVariables = Exact<{
  pathWithNamespace: Scalars['String'];
  ref: Scalars['String'];
  pageToCurrent: Scalars['Boolean'];
  accessCode?: Maybe<Scalars['String']>;
  createdBefore?: Maybe<Scalars['Date']>;
}>;


export type ProjectHistoryQuery = { project: { history?: Maybe<(
      Pick<ProjectHistoryReturn, 'next' | 'remaining' | 'receivedCurrent'>
      & { items: Array<(
        Pick<ProjectHistoryItem, 'itemType' | 'createdAt'>
        & { item: (
          { __typename: 'ReleaseBasic' }
          & Pick<ReleaseBasic, 'tag' | 'createdAt'>
        ) | (
          { __typename: 'CommitGroup' }
          & { commits: Array<Pick<Commit, 'id' | 'message' | 'createdAt'>> }
        ) | (
          { __typename: 'ExperimentRun' }
          & Pick<ExperimentRun, 'id' | 'name' | 'experimentSrc' | 'createdAt'>
          & { packageData?: Maybe<Pick<ExperimentPackageData, 'metricName' | 'metricObjective'>>, simulationRuns: Array<Pick<SimulationRun, 'id' | 'stepsLink' | 'analysisLink' | 'propertyValues' | 'metricOutcome'>> }
        ) }
      )> }
    )> } };

export type FilesFragmentFragment = { files: Array<Pick<ProjectFile, 'name' | 'path' | 'contents' | 'ref'>>, dependencies: Array<(
    Pick<Release, 'pathWithNamespace' | 'tag' | 'latestReleaseTag' | 'canUserEdit' | 'visibility'>
    & { files: Array<Pick<ProjectFile, 'name' | 'path' | 'dependencyPath' | 'contents' | 'ref'>> }
  )> };

export type FullProjectFragmentFragment = (
  Pick<Project, 'id' | 'name' | 'description' | 'image' | 'thumbnail' | 'createdAt' | 'updatedAt' | 'canUserEdit' | 'pathWithNamespace' | 'namespace' | 'type' | 'ref' | 'visibility' | 'ownerType' | 'keywords'>
  & { forkOf?: Maybe<Pick<ForkOfProject, 'pathWithNamespace'>>, latestRelease?: Maybe<Pick<ReleaseBasic, 'tag' | 'createdAt'>>, license?: Maybe<Pick<License, 'id' | 'name'>> }
  & FilesFragmentFragment
);

export type ProjectByPathQueryVariables = Exact<{
  pathWithNamespace: Scalars['String'];
  version: Scalars['String'];
  accessCode?: Maybe<Scalars['String']>;
}>;


export type ProjectByPathQuery = { project: FullProjectFragmentFragment };
