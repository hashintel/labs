import React, { FC, useEffect, useLayoutEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useModal } from "react-modal-hook";
import { unwrapResult } from "@reduxjs/toolkit";

import { AppDispatch } from "../../../features/types";
import {
  LinkableProject,
  SimulationProject,
} from "../../../features/project/types";
import { ModalNewProject } from "../../Modal/NewProject/ModalNewProject";
import { Scope, useScopes } from "../../../features/scopes";
import { fetchProject } from "../../../features/project/slice";
import { forceLogIn } from "../../../features/user/utils";
import { forkProject } from "../../../features/project/thunks";
import { selectBootstrapped } from "../../../features/user/selectors";
import { selectCurrentProject } from "../../../features/project/selectors";
import { urlFromProject } from "../../../routes";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";
import { useNavigateAway } from "./hooks";

const useEnsureProject = (
  project: LinkableProject,
  onCancel: VoidFunction
): SimulationProject | null => {
  const dispatch = useDispatch<AppDispatch>();
  const currentProject = useSelector(selectCurrentProject);
  const bootstrapped = useSelector(selectBootstrapped);
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
      const promise = dispatch(fetchProject({ project, redirect: false }));

      (async () => {
        try {
          const result = unwrapResult(await promise);

          if (!result) {
            onCancelRef.current();
          }
        } catch (err) {
          if (err?.name !== "AbortError") {
            fatalError(err);
          }
        }
      })();

      return () => {
        promise.abort();
      };
    }
  }, [bootstrapped, dispatch, fatalError, isCurrentProject, project]);

  return isCurrentProject ? currentProject : null;
};

export const HashRouterEffectFork: FC<{
  project: LinkableProject;
}> = ({ project: targetProject }) => {
  const navigateAway = useNavigateAway(targetProject);
  const dispatch = useDispatch<AppDispatch>();
  const { canFork, canForkIfSignedIn, canLogin } = useScopes(
    Scope.fork,
    Scope.forkIfSignedIn,
    Scope.login
  );
  const project = useEnsureProject(targetProject, () =>
    canLogin ? forceLogIn(true) : navigateAway(true)
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
            await dispatch(forkProject(project, values));
            hideForkModal();
          }}
          defaultName={projectName}
          action="Fork Project"
          defaultVisibility={projectVisibility}
          visibilityDisabled={projectVisibility === "private"}
        />
      ) : null,
    [dispatch, navigateAway, project, projectName, projectVisibility]
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
