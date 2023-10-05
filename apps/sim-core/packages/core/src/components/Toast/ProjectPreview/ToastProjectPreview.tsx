import React, { FC, useEffect, useState } from "react";
import { useSelector } from "react-redux";

import { Scope, useScope } from "../../../features/scopes";
import { SimulationProject } from "../../../features/project/types";
import { SimulationToast } from "../SimulationToast";
import { ToastAnchor } from "../Anchor";
import { forkUrlFromProject, mainProjectPath } from "../../../routes";
import { selectUserProfileUrl } from "../../../features/user/selectors";
import { useHandlePromiseRejection } from "../../ErrorBoundary";

// import { userForks } from "../../../util/api/queries/userForks";

const DriveButtons: FC<{
  numCopies: number;
  existingUrl: string;
}> = ({ numCopies, existingUrl }) => {
  const url = useSelector(selectUserProfileUrl);

  return numCopies === 1 ? (
    <ToastAnchor icon="pencil" path={existingUrl}>
      OPEN EXISTING
    </ToastAnchor>
  ) : url ? (
    <ToastAnchor icon="fileFind" path={url}>
      OPEN PROJECTS
    </ToastAnchor>
  ) : null;
};

const ToastText: FC<{
  numCopies: number;
  project: SimulationProject;
}> = ({ numCopies, project }) => {
  const simulationName = <strong>{project.name.trim()}</strong>;

  switch (numCopies) {
    case 0:
      return <>You are viewing a preview of {simulationName}.</>;
    case 1:
      return <>A copy of {simulationName} already exists in your projects.</>;
    default:
      return (
        <>Multiple copies of {simulationName} already exist in your projects.</>
      );
  }
};

export const ToastProjectPreview: FC<{
  project: SimulationProject;
}> = ({ project }) => {
  const canFork = useScope(Scope.fork);
  const forkUrl = forkUrlFromProject(project);
  const [data, _setData] = useState<{
    numCopies: number;
    existingPath: string;
  } | null>(null);
  const handlePromiseRejection = useHandlePromiseRejection();
  const code = project.access?.code;

  useEffect(() => {
    const controller = new AbortController();

    // Migration Shim
    // handlePromiseRejection(
    //   (async () => {
    //     const signal = controller.signal;
    //     const forks : String []= [];// await userForks(project.pathWithNamespace, code, signal);

    //     setData({
    //       numCopies: forks.length,
    //       existingPath: forks[0],
    //     });
    //   })()
    // );

    return () => {
      controller.abort();
    };
  }, [code, handlePromiseRejection, project.pathWithNamespace]);

  if (!data) {
    return null;
  }

  return (
    <SimulationToast theme="warning" isDismissable>
      <span>
        <ToastText numCopies={data.numCopies} project={project} /> Edits to this{" "}
        {project.type.toLowerCase()} will not be automatically saved.
        {canFork ? (
          <>
            Go to <strong>File &gt; Fork Project</strong> to create a fork.
          </>
        ) : null}
      </span>
      {data.existingPath ? (
        <DriveButtons
          existingUrl={mainProjectPath(data.existingPath)}
          numCopies={data.numCopies}
        />
      ) : null}
      {canFork ? (
        <ToastAnchor path={forkUrl} icon="fork">
          FORK PROJECT
        </ToastAnchor>
      ) : null}
    </SimulationToast>
  );
};
