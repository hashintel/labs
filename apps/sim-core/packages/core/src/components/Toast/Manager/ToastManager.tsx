import React, { FC, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { CSSTransition, TransitionGroup } from "react-transition-group";

import { HcFileKind } from "../../../features/files/enums";
import {
  ToastKind,
  selectToastData,
  selectToastKind,
} from "../../../features/toast";
import { ToastLegacySimulationAccess } from "../LegacySimulationAccess";
import { ToastProjectEditable } from "../ProjectEditable/ProjectEditable";
import { ToastProjectForked } from "../ProjectForked";
import { ToastProjectPreview } from "../ProjectPreview";
import { ToastReadOnlyRelease } from "../ReadOnlyRelease";
import { ToastReleaseBehaviorSuccess } from "../ReleaseBehaviorSuccess";
import { ToastReleaseSuccess } from "../ReleaseSuccess";
import { selectCurrentProject } from "../../../features/project/selectors";
import { selectEditorVisible } from "../../../features/viewer/selectors";
import { selectUserProjectsLoaded } from "../../../features/user/selectors";

import "./ToastManager.css";

const TOAST_TIMEOUT = 600;

const useToastData = () => {
  // @todo type this
  const reduxData = useSelector(selectToastData);
  const [data, setData] = useState<any>(null);

  if (reduxData && reduxData !== data) {
    setData(reduxData);
  }

  /**
   * We have to delay clearing of data because otherwise the toast might crash
   * during the animated exit.
   *
   * @todo find a better way to handle this
   */
  useEffect(() => {
    const effect = () => setData(reduxData);

    if (reduxData) {
      effect();
    } else {
      const timeout = setTimeout(effect, TOAST_TIMEOUT);

      return () => {
        clearTimeout(timeout);
      };
    }
  }, [reduxData]);

  return data;
};

export const ToastManager: FC = () => {
  // @todo this should come from the data
  const project = useSelector(selectCurrentProject);
  const userProjectsLoaded = useSelector(selectUserProjectsLoaded);
  const toastKind = useSelector(selectToastKind);
  const editorVisible = useSelector(selectEditorVisible);
  const data = useToastData();

  const toast = project
    ? {
        [ToastKind.LegacySimulationAccess]: (
          <ToastLegacySimulationAccess nextToast={data} />
        ),
        [ToastKind.ProjectEditable]: <ToastProjectEditable project={project} />,
        [ToastKind.ProjectForked]: data ? (
          <ToastProjectForked project={data} />
        ) : null,
        [ToastKind.ProjectPreview]: userProjectsLoaded ? (
          <ToastProjectPreview project={project} />
        ) : null,
        [ToastKind.ReadOnlyRelease]: <ToastReadOnlyRelease project={project} />,
        [ToastKind.ReleaseBehaviorSuccess]:
          data?.kind === HcFileKind.SharedBehavior ? (
            <ToastReleaseBehaviorSuccess files={data} />
          ) : null,
        [ToastKind.ReleaseSuccess]: <ToastReleaseSuccess project={project} />,

        [ToastKind.None]: null,
      }[toastKind]
    : null;

  return (
    <TransitionGroup className="ToastManager">
      {toast && editorVisible && (
        <CSSTransition
          timeout={TOAST_TIMEOUT}
          key="item"
          classNames="ToastManager__Item"
        >
          {toast}
        </CSSTransition>
      )}
    </TransitionGroup>
  );
};
