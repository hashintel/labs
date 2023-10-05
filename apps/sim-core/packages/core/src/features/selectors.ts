import { createSelector } from "@reduxjs/toolkit";
import orderBy from "lodash/orderBy";

import { LinkableProject } from "./project/types";
import { selectEditorVisible, selectUserAlerts } from "./viewer/selectors";
import { selectExamples } from "./examples/selectors";
import { selectGlobals } from "./files/selectors";
import { selectUserProjects } from "./user/selectors";

export const selectDefaultLinkableProject = createSelector(
  selectUserProjects,
  selectExamples,
  (userProjects, examples): LinkableProject | null => {
    const listToUse = userProjects.length ? userProjects : examples;
    const project = orderBy(listToUse, "updatedAt", "desc")[0];

    return project
      ? {
          pathWithNamespace: project.pathWithNamespace,
          ref: userProjects.length ? "main" : project.ref,
        }
      : null;
  }
);

export const selectDisplayEditorSection = createSelector(
  [selectEditorVisible, selectGlobals, selectUserAlerts],
  (editorVisible, globals, alerts) => {
    if (editorVisible || alerts.length > 0) {
      return true;
    }

    if (!globals) {
      return false;
    }

    try {
      const parsed = JSON.parse(globals);
      if (!parsed) {
        return false;
      }

      return Object.keys(parsed).length > 0;
    } catch (err) {
      return true;
    }
  }
);
