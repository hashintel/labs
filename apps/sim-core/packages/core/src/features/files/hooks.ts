import { useCallback } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import JSZip from "jszip";
import { navigate } from "hookrouter";
import { saveAs } from "file-saver";

import { AppDispatch, RootState } from "../types";
import { FilePathParts } from "../../util/files/types";
import { HcFile } from "./types";
import { HcFileKind } from "./enums";
import {
  ProjectFile,
  RemoteSimulationProject,
  SimulationProjectWithHcFiles,
} from "../project/types";
import { addUserProject } from "../user/slice";
import { fromFormatted } from "../../util/files/parse";
import { preparePartialSimulationProject, toHcConfig } from "../project/utils";
import { save } from "../thunks";
import {
  selectAllFiles,
  selectCurrentFileId,
  selectFileEntities,
} from "./selectors";
import { selectCurrentProject } from "../project/selectors";
import { setProjectWithMeta } from "../actions";
import { slugify, urlFromProject } from "../../routes";
import { stringifyBehaviorKeys, toHcFiles } from "./utils";
import { trackEvent } from "../analytics";

export const useSelectFileById = (fileId: string): HcFile => {
  try {
    return useSelector(
      useCallback(
        (state: RootState) => {
          const entity = selectFileEntities(state)[fileId];

          if (!entity) {
            throw new Error("Cannot render file that does not exist");
          }

          return entity;
        },
        [fileId],
      ),
    );
  } catch (err) {
    /**
     * We have to do this console log outside of useSelector because of the
     * potential for the Redux "zombie children" issue…
     *
     * @see https://react-redux.js.org/api/hooks#stale-props-and-zombie-children
     */
    console.error("Cannot find file", fileId);
    throw err;
  }
};

export const useFileIsCurrent = (fileId: string) =>
  useSelector(
    useCallback(
      (state: RootState) => selectCurrentFileId(state) === fileId,
      [fileId],
    ),
  );

export const useExportFiles = () => {
  const store = useStore();

  const exportFiles = async () => {
    const state = store.getState();
    const allFiles = selectAllFiles(state);
    const currentProject = selectCurrentProject(state);

    const zip = new JSZip();

    for (const file of allFiles) {
      let path = "";

      if ("pathWithNamespace" in file && file.ref) {
        path = `dependencies/${file.pathWithNamespace}/`;
      }

      // the repo path for datasets points to a .json file containing metadata.
      // we drop the final .json when naming the file with the actual contents.
      path +=
        file.kind === HcFileKind.Dataset
          ? file.repoPath.replace(/\.json$/i, "")
          : file.repoPath;

      zip.file(path, file.contents);

      if (
        file.kind === HcFileKind.Behavior ||
        file.kind === HcFileKind.SharedBehavior
      ) {
        const behaviorKeysJson = stringifyBehaviorKeys(file);
        zip.file(`${path}.json`, behaviorKeysJson);
      }
    }

    const hashJson = currentProject?.config;
    if (hashJson) {
      zip.file("hash.json", JSON.stringify(hashJson, null, 2));
    }

    const fileZip = await zip.generateAsync({ type: "blob" });
    saveAs(
      fileZip,
      `${currentProject?.pathWithNamespace.split("/").pop()}.zip`,
    );
  };

  return exportFiles;
};

export const useImportFiles = () => {
  const dispatch = useDispatch<AppDispatch>();

  const importFiles = async (files: FileList) => {
    if (files.length === 0) {
      // They pushed 'cancel' on the dialog.
      return;
    }
    const file = files[0];

    if (file.type !== "application/zip") {
      throw "Please upload a .zip file";
    }

    const fileName = file.name.split(".").slice(0, -1).join(".");

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err: any) {
      throw "Error unzipping " + file.name + ": " + err.message;
    }
    const projectFiles: ProjectFile[] = [];
    const zipFiles: {
      name: string;
      contentPromise: Promise<string>;
    }[] = [];

    zip.forEach((_relativePath, zipEntry) => {
      if (zipEntry.dir) {
        // Skip directories.
        return;
      }

      // Some zip files put leading '/'s on the file names.
      // Trim those out so that HASH doesn't nest it as a folder.
      while (zipEntry.name.startsWith("/")) {
        zipEntry.name = zipEntry.name.slice(1);
      }

      if (zipEntry.name.startsWith(".")) {
        // Skip hidden files
        return;
      }

      let parsed: FilePathParts | null = null;
      try {
        parsed = fromFormatted(zipEntry.name);
      } catch (err) {
        console.warn("Skipping file in import:", zipEntry.name, err);
        return;
      }

      if (parsed.dir) {
        const permittedDirs = ["src", "data", "views", "dependencies"];
        const candidateDir = parsed.dir.split("/")[0];
        if (!permittedDirs.includes(candidateDir)) {
          console.warn("Skipping directory in import", parsed.dir);
          return;
        }
      }

      // Convert to a simple array so we can later await the promises.
      zipFiles.push({
        name: zipEntry.name,
        contentPromise: zipEntry.async("text"),
      });
    });

    for (const zipFile of zipFiles) {
      const contents = await zipFile.contentPromise;
      projectFiles.push({
        name: zipFile.name.replace(/^.*[\\/]/, ""),
        path: zipFile.name,
        contents: contents,
        ref: "1.0",
      });
    }

    const namespace = "@imported";
    const path = slugify(fileName);

    const importedProject: RemoteSimulationProject = {
      id: `${path}`,
      name: path,
      description: "",
      image: null,
      thumbnail: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      canUserEdit: true,
      pathWithNamespace: `${namespace}/${path}`,
      namespace: namespace,
      type: "Simulation",
      ref: "main",
      visibility: "public",
      ownerType: "User",
      forkOf: null,
      latestRelease: null,
      license: {
        id: "5dc3da73cc0cf804dcc66a51",
        name: "MIT License",
      },
      keywords: [],
      files: projectFiles,
    };

    const project: SimulationProjectWithHcFiles = {
      ...importedProject,
      config: toHcConfig(importedProject),
      files: toHcFiles(importedProject),
      ref: importedProject.ref ?? "main",
      access: null,
    };

    dispatch(
      trackEvent({
        action: "Import Project: Core",
        label: project.pathWithNamespace,
      }),
    );

    dispatch(addUserProject(preparePartialSimulationProject(project)));
    dispatch(setProjectWithMeta(project));
    navigate(urlFromProject(project), false, {}, true);
    await dispatch(save());
  };

  return importFiles;
};
