import { createSelector } from "reselect";

import { ResourceProject } from "../../../features/project/types";
import { mapLegacyDependencyFormat } from "../../../features/project/utils";
import {
  selectParsedDependencies,
  selectPendingDependencies,
} from "../../../features/files/selectors";

export const selectPathsForDependencies = createSelector(
  [selectParsedDependencies, selectPendingDependencies],
  (deps, pending) => [
    ...new Set(
      Object.keys(deps)
        /**
         * This is necessary because some dependencies are specified in a legacy
         * "two-part" format (old index behaviors), and we need to know that the
         * correctly formatted version of that dependency is included so it
         * cannot be added again by the resources picker.
         *
         * @todo remove this when we remove the old format
         */
        .flatMap((dep) => [...new Set([dep, mapLegacyDependencyFormat(dep)])])
        .concat(pending)
    ),
  ]
);

export const makeSelectPresentItemsFromResource = () =>
  createSelector(
    selectPathsForDependencies,
    (_: any, resource: ResourceProject) => resource,
    (paths, resource) =>
      resource.files.reduce<string[]>((result, file) => {
        if (paths.includes(file.path.formatted)) {
          result.push(file.path.formatted);
        }

        return result;
      }, [])
  );
