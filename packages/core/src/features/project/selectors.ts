import { createSelector, Selector } from "@reduxjs/toolkit";
import { createStructuredSelector } from "reselect";

import { LinkableProject, ProjectSlice } from "./types";
import { RootState } from "../types";
import { forkUrlFromProject, urlFromProject } from "../../routes";
import { isProjectLatest, refIsNotCommit } from "./utils";

export const selectProjectSlice: Selector<RootState, ProjectSlice> = (state) =>
  state.project;

/**
 * Uses of this need to be more careful – because it can trigger a re-render on
 * save as updatedat gets updated
 *
 * @todo fix that – perhaps move updatedat out of the project
 */
export const selectCurrentProject = createSelector(
  selectProjectSlice,
  (slice) => slice.currentProject,
);

export const selectCurrentProjectRequired = createSelector(
  selectCurrentProject,
  (project) => {
    if (!project) {
      throw new Error("Project does not exist when it is required");
    }

    return project;
  },
);

export const selectCurrentProjectUrl = createSelector(
  selectCurrentProject,
  (project) => (project ? urlFromProject(project) : null),
);

export const selectProjectLoaded = createSelector(
  selectProjectSlice,
  (slice) => slice.projectLoaded,
);

export const selectAccessGate = createSelector(
  selectProjectSlice,
  (slice) => slice.accessGate,
);

export const selectProjectLatest = createSelector(
  selectCurrentProject,
  (project) => (project ? isProjectLatest(project) : null),
);

export const selectProjectConfig = createSelector(
  selectCurrentProject,
  (project) => project?.config,
);

const emptyArray: string[] = [];
export const selectProjectPublishedFiles = createSelector(
  selectProjectConfig,
  (config) => config?.files ?? emptyArray,
);

export const selectProjectUpdated = createSelector(
  selectCurrentProject,
  (project) => project?.updatedAt ?? null,
);

export const selectHasProject = createSelector(
  selectCurrentProject,
  (project) => !!project,
);

export const selectLatestReleaseTag = createSelector(
  selectCurrentProject,
  (project) => project?.latestRelease?.tag,
);

export const selectProjectAccess = createSelector(
  selectCurrentProject,
  (project) => project?.access,
);

export const selectForkCurrentProjectUrl = createSelector(
  [selectCurrentProject],
  (project) => (project ? forkUrlFromProject(project) : null),
);

const selectPendingProject = createSelector(
  [selectProjectSlice],
  (slice) => slice.pendingProject,
);

export const selectProjectPathWithNamespace = createSelector(
  selectCurrentProject,
  (project) => project?.pathWithNamespace,
);

export const selectProjectPathWithNamespaceRequired = createSelector(
  selectProjectPathWithNamespace,
  (pathWithNamespace) => {
    if (typeof pathWithNamespace !== "string") {
      throw new Error("Project does not exist when it is required");
    }

    return pathWithNamespace;
  },
);

export const selectProjectRef = createSelector(
  selectCurrentProject,
  (project) => (project ? project.ref ?? "main" : null),
);

/**
 * @deprecated
 * @todo use a scope for this
 */
export const selectRefIsNotCommit = createSelector(
  selectProjectRef,
  refIsNotCommit,
);

export const selectLinkableProject = createStructuredSelector<
  RootState,
  LinkableProject
>({
  pathWithNamespace: selectProjectPathWithNamespaceRequired,
  ref: selectProjectRef,
});

export const selectVersionSwitchingTo = createSelector(
  [selectProjectPathWithNamespace, selectPendingProject],
  (pathWithNamespace, pendingProject) =>
    pendingProject && pathWithNamespace === pendingProject.pathWithNamespace
      ? pendingProject.ref ?? "main"
      : null,
);
