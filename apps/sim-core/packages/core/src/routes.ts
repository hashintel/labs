import _slugify from "slugify";
import urljoin from "url-join";

import { LinkableProject, SimulationProject } from "./features/project/types";
import { SITE_URL } from "./util/api/paths";
import { getSafeQueryParams } from "./util/getSafeQueryParams";

export const slugify = (value: string) =>
  _slugify(value, {
    lower: true,
    remove: /[^\w-\s]/g,
  });

const HASH_BUILD_STAMP_RE = /hash-(?:(?:prod)|(?:dev))-[0-9]{4}-[0-9]{2}-[0-9]{2}-T[0-9]{4}_[0-9]{5}(-pr-[0-9]+)?/;
export const getBuildStampFromUrl = () =>
  HASH_BUILD_STAMP_RE.exec(location.pathname)?.[0];

export const getRouteFromQuery = () => {
  const route = getSafeQueryParams().route ?? "";
  const [path, ...queryParts] = route.split("?");
  const queryString = queryParts.join("?");

  return {
    path: `/${path.replace(/^\//, "")}`,
    query: Object.fromEntries(new URLSearchParams(queryString).entries()),
  };
};

export const getUrlForRouteWithBuildStamp = (
  route: string,
  buildStamp = WEBPACK_BUILD_STAMP
) =>
  `${origin}/${buildStamp}/index.html${
    route ? `?route=${encodeURIComponent(route)}` : ""
  }`;

export const getCurrentRoute = () => {
  const { origin, href } = window.location;

  return href.slice(origin.length).replace(/^\//, "");
};

export const getUrlForCurrentRouteWithBuildStamp = (
  buildStamp = WEBPACK_BUILD_STAMP
) => getUrlForRouteWithBuildStamp(getCurrentRoute(), buildStamp);

// @todo should this take into account access codes?
export const urlFromProject = (project: LinkableProject): string => {
  if (!project.pathWithNamespace) {
    throw new Error("Cannot generate URL for empty project");
  }

  return urljoin(`/${project.pathWithNamespace}`, project.ref ?? "main");
};

export const forkUrlFromProject = (project: LinkableProject): string =>
  `${urlFromProject(project)}/fork`;

export const mainProjectPath = (pathWithNamespace: string) =>
  urlFromProject({
    pathWithNamespace,
  });

export const createMergeRequestUrl = (project: SimulationProject) =>
  project && project.forkOf
    ? urljoin(
        SITE_URL,
        project.forkOf.pathWithNamespace,
        `merge-requests/new?compare=${urlFromProject(project)}`
      )
    : "";
