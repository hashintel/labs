import React, { FC, useEffect, useState } from "react";
import { CSSTransition, TransitionGroup } from "react-transition-group";

import { ToastKind } from "../../../features/toast";
import { ToastLegacySimulationAccess } from "../LegacySimulationAccess";
import { ToastProjectEditable } from "../ProjectEditable/ProjectEditable";
import { ToastProjectForked } from "../ProjectForked";
import { ToastProjectPreview } from "../ProjectPreview";
import { useProject } from "../../../features/project/ProjectContext";
import { useToast } from "../../../features/toast/ToastContext";
import { useUser } from "../../../features/user/UserContext";
import { useViewer } from "../../../features/viewer/ViewerContext";

import "./ToastManager.css";

const TOAST_TIMEOUT = 600;

const useToastData = () => {
  const { toastData: reduxData } = useToast();
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
  const { currentProject: project } = useProject();
  const { projectsLoaded: userProjectsLoaded } = useUser();
  const { toastKind } = useToast();
  const { editorVisible } = useViewer();
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
