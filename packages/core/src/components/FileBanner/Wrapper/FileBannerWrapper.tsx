import React, { FC } from "react";
import { useDispatch, useSelector } from "react-redux";

import { AppDispatch } from "../../../features/types";
import { Ext } from "../../../util/files/enums";
import {
  FileBannerBuiltin,
  FileBannerChoose,
  FileBannerShared,
  FileBannerUpgrade,
} from "..";
import { FileBannerPythonSafari } from "../PythonSafari";
import { FileBannerSignIn } from "../SignIn/FileBannerSignIn";
import type {
  HcFile,
  HcSharedBehaviorFile,
} from "../../../features/files/types";
import { HcFileKind } from "../../../features/files/enums";
import { Scope, useScopes } from "../../../features/scopes";
import { addDependencies } from "../../../features/files/slice";
import { fetchDependencies } from "../../../util/api";
import { getTextModelRequired } from "../../../features/monaco";
import { isReadOnly } from "../../../features/files/utils";
import { pyodideEnabled } from "../../../util/pyodideEnabled";
import { selectAllFiles } from "../../../features/files/selectors";
import {
  selectCurrentProject,
  selectCurrentProjectUrl,
} from "../../../features/project/selectors";
import { store } from "../../../features/store";

interface FileBannerWrapperProps {
  file: HcFile;
  nextContents: string | null;
  setNextContents: (nextContents: string | null) => void;
}

export const FileBannerWrapper: FC<FileBannerWrapperProps> = ({
  file,
  nextContents,
  setNextContents,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const project = useSelector(selectCurrentProject);
  const projectUrl = useSelector(selectCurrentProjectUrl);
  const { canEdit, canLogin } = useScopes(Scope.edit, Scope.login);

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
    if (canLogin && isReadOnly(file, false)) {
      return <FileBannerSignIn />;
    } else {
      return null;
    }
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
            (nextFile) => nextFile.dependencyPath === file.path.formatted,
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
          await dispatch(
            //@ts-expect-error redux problems
            addDependencies({
              [file.path.formatted]: latestTag,
            }),
          );

          const nextFile = selectAllFiles(store.getState()).find(
            (potentialFile) =>
              potentialFile.path.formatted === file.path.formatted &&
              (potentialFile as HcSharedBehaviorFile).ref === file.latestTag,
          );

          if (!nextFile) {
            throw new Error(
              `Tried to get dependency: ${file.path.formatted} (v${file.latestTag}) but it doesn't exist (yet)`,
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
