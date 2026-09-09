import React, { FC, useEffect, useLayoutEffect, useRef } from "react";
import { useModal } from "react-modal-hook";

import {
  LinkableProject,
  SimulationProject,
} from "../../../features/project/types";
import { ModalNewProject } from "../../Modal/NewProject/ModalNewProject";
import { Scope, useScopes } from "../../../features/scopes";
import { forceLogIn } from "../../../features/user/utils";
import { prepareForkProject } from "../../../features/project/thunks";
import { navigate } from "../../../util/navigation";
import { urlFromProject } from "../../../routes";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";
import { useNavigateAway } from "./hooks";
import { useProject } from "../../../features/project/ProjectContext";
import { useUser } from "../../../features/user/UserContext";
import { useToast } from "../../../features/toast/ToastContext";

const useEnsureProject = (
  project: LinkableProject,
  onCancel: VoidFunction,
): SimulationProject | null => {
  const { currentProject, fetchProject } = useProject();
  const { bootstrapped } = useUser();
  const fatalError = useFatalError();
  const isCurrentProject =
    !!(project && currentProject) &&
    urlFromProject(project) === urlFromProject(currentProject);

  const onCancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (bootstrapped && !isCurrentProject && project) {
      (async () => {
        try {
          const result = await fetchProject({ project, redirect: false });
          if (!result) {
            onCancelRef.current();
          }
        } catch (err: any) {
          if (err?.name !== "AbortError") {
            fatalError(err);
          }
        }
      })();
    }
  }, [bootstrapped, fetchProject, fatalError, isCurrentProject, project]);

  return isCurrentProject ? currentProject : null;
};

export const HashRouterEffectFork: FC<{
  project: LinkableProject;
}> = ({ project: targetProject }) => {
  const navigateAway = useNavigateAway(targetProject);
  const { canFork, canForkIfSignedIn, canLogin } = useScopes(
    Scope.fork,
    Scope.forkIfSignedIn,
    Scope.login,
  );
  const { setProjectWithMeta } = useProject();
  const { addUserProject } = useUser();
  const { displayToast } = useToast();
  const project = useEnsureProject(targetProject, () =>
    canLogin ? forceLogIn(true) : navigateAway(true),
  );
  const projectName = project?.name;
  const projectVisibility = project?.visibility;
  const hasProject = !!project;

  const [showForkModal, hideForkModal] = useModal(
    () =>
      project ? (
        <ModalNewProject
          onCancel={navigateAway}
          onSubmit={async (values) => {
            const result = prepareForkProject(project, values);
            if (result.partialProject) {
              addUserProject(result.partialProject);
            }
            setProjectWithMeta(result.nextProject);
            navigate(urlFromProject(result.nextProject));
            displayToast(result.toastData);
            hideForkModal();
          }}
          defaultName={projectName}
          action="Fork Project"
          defaultVisibility={projectVisibility}
          visibilityDisabled={projectVisibility === "private"}
        />
      ) : null,
    [
      navigateAway,
      project,
      projectName,
      projectVisibility,
      setProjectWithMeta,
      addUserProject,
      displayToast,
    ],
  );

  useEffect(() => {
    if (canForkIfSignedIn || canFork) {
      if (canFork) {
        showForkModal();
        return () => {
          hideForkModal();
        };
      } else {
        forceLogIn();
      }
    } else if (hasProject) {
      navigateAway(true);
    }
  }, [
    canFork,
    canForkIfSignedIn,
    hasProject,
    hideForkModal,
    navigateAway,
    showForkModal,
  ]);

  return null;
};
