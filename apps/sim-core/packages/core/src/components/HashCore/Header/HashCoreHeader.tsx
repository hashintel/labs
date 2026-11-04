import React, { FC } from "react";
import TimeAgo from "react-timeago";

import { HashCoreHeaderMenu } from "..";
import { IconBrain } from "../../Icon/Brain";
import { IconLock } from "../../Icon/Lock";
import { Logo } from "../../Logo";
import { Scope, useScope } from "../../../features/scopes";
import { projectIsPrivate } from "../../../features/project/utils";
import { selectDidSave } from "../../../features/files/selectors";
import { useFilesSelector } from "../../../features/files/FilesContext";
import { useProject } from "../../../features/project/ProjectContext";

import "./HashCoreHeader.css";

export const HashCoreHeader: FC = () => {
  const { currentProject: project } = useProject();
  const isSaved = useFilesSelector(selectDidSave);

  const projectUpdatedAtDate = project
    ? new Date(project.updatedAt)
    : undefined;

  const timeagoDate =
    !projectUpdatedAtDate ||
    projectUpdatedAtDate.getTime() > new Date().getTime()
      ? new Date()
      : projectUpdatedAtDate;

  const isBehaviorProject = project?.type === "Behavior";

  const canSave = useScope(Scope.save);

  /**
   * These svg icons have fractional sizes to ensure they don't have
   * fractional path heights which would cause them to jump around when
   * toasts appear/exit
   */
  const title = project ? (
    <span
      title={
        isBehaviorProject ? "You are viewing a behavior project" : undefined
      }
      className="HashCoreHeader-title"
    >
      {isBehaviorProject ? <IconBrain size={23.5} /> : null}
      {project.name}
      {!isSaved ? "*" : null}
      {projectIsPrivate(project) ? <IconLock size={15.2} /> : null}
    </span>
  ) : null;

  return (
    <header className="HashCoreHeader">
      <div className="HashCoreHeader__section HashCoreHeader__section--left">
        <div>
          <Logo className="HashCoreHeader-logo" logoSize={1} textSize={0.75} />
          <HashCoreHeaderMenu />
        </div>
      </div>
      <div className="HashCoreHeader__section HashCoreHeader__section--middle">
        {title}
        {project?.updatedAt && (
          <i className="HashCoreHeader-timeago">
            &nbsp;- last{" "}
            {
              /**
               * We show updated instead of saved if a user's updates are not
               * going to be automatically saved
               */
              canSave ? "saved" : "updated"
            }{" "}
            <TimeAgo date={timeagoDate} />
          </i>
        )}
      </div>
      <div className="HashCoreHeader__section HashCoreHeader__section--right"></div>
    </header>
  );
};
