import { useCallback } from "react";
import JSZip from "jszip";
import { navigate } from "../../util/navigation";
import { saveAs } from "file-saver";

import { FilePathParts } from "../../util/files/types";
import { HcFile } from "./types";
import { HcFileKind } from "./enums";
import {
  ProjectFile,
  RemoteSimulationProject,
  SimulationProjectWithHcFiles,
} from "../project/types";
import { fromFormatted } from "../../util/files/parse";
import { preparePartialSimulationProject, toHcConfig } from "../project/utils";
import { slugify, urlFromProject } from "../../routes";
import { stringifyBehaviorKeys, toHcFiles } from "./utils";

import { useFiles } from "./FilesContext";
import { useProject } from "../project/ProjectContext";
import { useUser } from "../user/UserContext";

export const useSelectFileById = (fileId: string): HcFile => {
  const { fileEntities } = useFiles();
  const entity = fileEntities[fileId];

  if (!entity) {
    console.error("Cannot find file", fileId);
    throw new Error("Cannot render file that does not exist");
  }

  return entity;
};

export const useFileIsCurrent = (fileId: string) => {
  const { currentFileId } = useFiles();
  return currentFileId === fileId;
};

export const useExportFiles = () => {
  const { allFiles } = useFiles();
  const { currentProject } = useProject();

  const exportFiles = useCallback(async () => {
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
  }, [allFiles, currentProject]);

  return exportFiles;
};

export const useImportFiles = () => {
  const { addUserProject } = useUser();
  const { setProjectWithMeta: contextSetProjectWithMeta } = useProject();

  const importFiles = async (files: FileList) => {
    if (files.length === 0) {
      return;
    }
    const file = files[0];

    if (file.type !== "application/zip") {
      throw new Error("Please upload a .zip file");
    }

    const fileName = file.name.split(".").slice(0, -1).join(".");

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Error unzipping ${file.name}: ${msg}`);
    }
    const projectFiles: ProjectFile[] = [];
    const zipFiles: {
      name: string;
      contentPromise: Promise<string>;
    }[] = [];

    zip.forEach((_relativePath, zipEntry) => {
      if (zipEntry.dir) {
        return;
      }

      while (zipEntry.name.startsWith("/")) {
        zipEntry.name = zipEntry.name.slice(1);
      }

      if (zipEntry.name.startsWith(".")) {
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

      zipFiles.push({
        name: zipEntry.name,
        contentPromise: zipEntry.async("text"),
      });
    });

    for (const zipFile of zipFiles) {
      const contents = await zipFile.contentPromise;
      projectFiles.push({
        name: zipFile.name.replace(/^.*[\\\/]/, ""),
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

    let project: SimulationProjectWithHcFiles;
    try {
      project = {
        ...importedProject,
        config: toHcConfig(importedProject),
        files: toHcFiles(importedProject),
        ref: importedProject.ref ?? "main",
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "Unknown error");
      throw new Error(`Error parsing imported project: ${msg}`);
    }

    addUserProject(preparePartialSimulationProject(project));
    contextSetProjectWithMeta(project);
    navigate(urlFromProject(project), false, {}, true);
    // TODO: save() was an async thunk that saved to server.
    // In local-first mode, state is auto-persisted to localStorage.
  };

  return importFiles;
};
