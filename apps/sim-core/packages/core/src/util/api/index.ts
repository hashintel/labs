export {
  IS_DEV,
  SIMULATIONS_URL,
  IS_LOCAL,
  IS_STAGING,
  SITE_URL,
} from "./paths";

//
// API javascript bindings.
// We [should switch to Apollo](https://www.apollographql.com/docs/react/),
// In the meantime we keep it simple.
//
export {
  // user
  bootstrapQuery,
  trackTourProgress,
  // simulations
  myProjects,
  linkableProjectByLegacyId,
  exampleSimulations,
  getOnboardingProject,
  // dependencies
  fetchDependencies,
  // simulation listings
  getReleaseMeta,
  getTourShowcase,
  // behaviors and datasets
  searchResourceProjects,
} from "./queries";

export { QueryError } from "./query";
