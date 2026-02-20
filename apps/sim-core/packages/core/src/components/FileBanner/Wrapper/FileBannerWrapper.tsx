import React, { FC } from "react";

import { Ext } from "../../../util/files/enums";
import {
  FileBannerBuiltin,
  FileBannerChoose,
  FileBannerShared,
  FileBannerUpgrade,
} from "..";
import { FileBannerPythonSafari } from "../PythonSafari";
import type {
  HcFile,
  HcSharedBehaviorFile,
} from "../../../features/files/types";
import { HcFileKind } from "../../../features/files/enums";
import { Scope, useScope } from "../../../features/scopes";
import { fetchDependencies } from "../../../util/api";
import { getTextModelRequired } from "../../../features/monaco";
import { pyodideEnabled } from "../../../util/pyodideEnabled";
import { useFiles } from "../../../features/files/FilesContext";
import { useProject } from "../../../features/project/ProjectContext";

type FileBannerWrapperProps = {
  file: HcFile;
  nextContents: string | null;
  setNextContents: (nextContents: string | null) => void;
};

export const FileBannerWrapper: FC<FileBannerWrapperProps> = ({
  file,
  nextContents,
  setNextContents,
}) => {
  const { handleAddDependencies, allFiles } = useFiles();
  const { currentProject: project, currentProjectUrl: projectUrl } = useProject();
  const canEdit = useScope(Scope.edit);

  /**
   * show the Python/Safari banner for any `.py` file (even local) if Pyodide
   * is not supported.
   */
  if (file.path.ext === Ext.Py && !pyodideEnabled()) {
    return <FileBannerPythonSafari />;
  }

  if (file.path.ext === Ext.Rs) {
    return <FileBannerBuiltin />;
  }

  if (!canEdit) {
    return null;
  }

  /**
   * everything else only applies to shared behaviors
   */
  if (file.kind !== HcFileKind.SharedBehavior) {
    return null;
  }

  const { latestTag } = file;
  if (latestTag && file.ref !== latestTag && file.ref < latestTag) {
    return nextContents === null ? (
      <FileBannerUpgrade
        onClick={async () => {
          const releases = await fetchDependencies({
            [file.path.formatted]: latestTag,
          });

          const nextFile = releases[0]?.files.find(
            (nextFile) => nextFile.dependencyPath === file.path.formatted
          );

          if (!nextFile) {
            throw new Error("Could not find behavior to upgrade to");
          }

          setNextContents(nextFile.contents);
        }}
      />
    ) : (
      <FileBannerChoose
        labelA={`Keep current (v${file.ref})`}
        onChooseA={() => {
          setNextContents(null);
        }}
        labelB={`Upgrade to (v${latestTag})`}
        onChooseB={async () => {
          await handleAddDependencies({
            [file.path.formatted]: latestTag,
          });

          const nextFile = allFiles.find(
            (potentialFile) =>
              potentialFile.path.formatted === file.path.formatted &&
              (potentialFile as HcSharedBehaviorFile).ref === file.latestTag
          );

          if (!nextFile) {
            throw new Error(
              `Tried to get dependency: ${file.path.formatted} (v${file.latestTag}) but it doesn't exist (yet)`
            );
          }

          /**
           * nextContents here should always equal nextFile.contents, which
           * the monaco integration updates the model to match, so this
           * condition should never fire.
           *
           * @todo investigate removing this code
           */
          const textModel = getTextModelRequired(nextFile, projectUrl);
          if (textModel.getValue() !== nextContents) {
            textModel.setValue(nextContents);
          }
        }}
      />
    );
  }

  if (!project) {
    throw new Error("cannot show file banner for non-existent project");
  }

  return <FileBannerShared file={file} project={project} />;
};
