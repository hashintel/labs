import { pick } from "lodash";

import type {
  LocalStorageProject,
  PartialSimulationProject,
  RemoteSimulationProject,
  SimulationProject,
  SimulationProjectConfig,
  SimulationProjectWithHcFiles,
  UnpreparedPartialSimulationProject,
} from "./types";
import { getItem } from "../../hooks/useLocalStorage";
import { isBehaviorKeyFile } from "../files/utils";
import { localStorageProjectKey } from "../../util/localStorageProjectKey";

export const partialSimulationProjectFields = [
  "name",
  "updatedAt",
  "ref",
  "pathWithNamespace",
  "forkOf",
  "type",
  "visibility",
] as const;

export type PartialSimulationProjectFieldsTuple = typeof partialSimulationProjectFields;

export const preparePartialSimulationProject = ({
  latestRelease,
  ...partial
}: UnpreparedPartialSimulationProject): PartialSimulationProject =>
  pick(
    {
      ...partial,
      ref: latestRelease?.tag ?? "main",
    },
    partialSimulationProjectFields
  );

/**
 * @todo replace uses of this with scopes
 * @deprecated
 */
export const isProjectLatest = (project: SimulationProject) =>
  project.ref === "main";

/**
 * @todo this should return the full path for files
 */
export const toHcConfig = (
  project: Pick<RemoteSimulationProject, "files" | "keywords" | "type">
): SimulationProjectConfig => {
  const { files, keywords, type } = project;
  let config = {
    files,
    keywords,
    type,
  };
  try {
    config = JSON.parse(
      project.files.find((file) => file.path === "hash.json")!.contents
    );
  } catch (exception) {
    // TODO: track event
  }
  return {
    ...config,
    files:
      config.files
        ?.filter((file: any) => !isBehaviorKeyFile(file.filename ?? file.path))
        .map((file: any) => file.filename ?? file.path) ?? [],
  };
};

/**
 * Maps a "legacy dependency format" to what it would have been mapped to during
 * the migration. Necessary because in some places we need to be able to use the
 * full new format when we only have the old one.
 *
 * @todo remove this when we remove the old format
 */
export const mapLegacyDependencyFormat = (dependency: string) => {
  const parts = dependency.split("/");

  if (parts.length !== 2) {
    return dependency;
  }

  return [
    parts[0],
    parts[1].replace(/\..*?$/, "").replace(/_/g, "-"),
    parts[1],
  ].join("/");
};

export const getLocalStorageProject = (
  pathWithNamespace: string,
  ref?: string | null
): LocalStorageProject | null => {
  const key = localStorageProjectKey({ pathWithNamespace, ref });
  const localProject = getItem<LocalStorageProject>(key);

  // Migration shim-- deprecate old localStorage guards, as we're starting from a fresh state.
  // if (localProject) {
  //   if (
  //     /**
  //      * This is shortcut for "is this the old project format" – we want to remove
  //      * that if it is and not use it.
  //      */
  //     localProject.id !== pathWithNamespace ||
  //     /**
  //      * In order to reduce the likelihood of a bug from the format of local
  //      * storage and the API becoming out of date, let's only use this backup
  //      * if it has some actions that are of use to us.
  //      *
  //      * @todo change to only backing up actions
  //      */
  //     localProject?.actions.length === 0
  //   ) {
  //     removeItem(key);

  //     return null;
  //   }

  //   /**
  //    * For a while we didn't include namespace in local storage backups but
  //    * we need this now so let's ensure it's in there. We can calculate it if it's
  //    * missing.
  //    */
  //   if (!localProject.namespace) {
  //     localProject.namespace = localProject.pathWithNamespace
  //       .split("/")[0]
  //       .slice(1);
  //   }
  // }

  return localProject;
};

export const isStoringProjectActions = (
  project: SimulationProjectWithHcFiles | LocalStorageProject
): project is LocalStorageProject => "actions" in project;

export const projectIsPrivate = (
  project: Pick<SimulationProject, "visibility">
) => project.visibility === "private";

export const refIsNotCommit = (ref: string | null) =>
  !ref || ref.length !== 40 || ref.includes(".");
