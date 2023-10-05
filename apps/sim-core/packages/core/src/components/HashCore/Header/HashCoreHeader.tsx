import React, { FC, lazy, Suspense, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import TimeAgo from "react-timeago";
import { useModal } from "react-modal-hook";
import urljoin from "url-join";

import { HashCoreHeaderMenu } from "..";
import { HashCoreHeaderShareButton } from "./ShareButton/HashCoreHeaderShareButton";
import { HashCoreHeaderUserImage } from "./UserImage/HashCoreHeaderUserImage";
import { IS_STAGING, SITE_URL, getReleaseMeta } from "../../../util/api";
import { IconBrain } from "../../Icon/Brain";
import { IconLock } from "../../Icon/Lock";
import { Link } from "../../Link/Link";
import { Logo } from "../../Logo";
import { ModalPrivateDependencies } from "../../Modal/PrivateDependencies";
import { ModalReleaseCreate, ModalReleaseUpdate } from "../../Modal";
import type { ReleaseMeta } from "../../../util/api/types";
import { Scope, useScopes } from "../../../features/scopes";
import { coreVersions } from "../../../util/api/queries";
import { projectIsPrivate } from "../../../features/project/utils";
import { selectCurrentProject } from "../../../features/project/selectors";
import {
  selectDidSave,
  selectProjectHasPrivateDependencies,
} from "../../../features/files/selectors";

import "./HashCoreHeader.css";

const shouldShowVersionPicker = IS_STAGING;

const HashVersionPicker = shouldShowVersionPicker
  ? lazy(() =>
      import(
        /* webpackChunkName: "HashVersionPicker" */ "./HashVersionPicker"
      ).then((module) => ({
        default: module.HashVersionPicker,
      }))
    )
  : null;

export const HashCoreHeader: FC = () => {
  const project = useSelector(selectCurrentProject);
  const [versions, setVersions] = useState<string[]>([]);
  const isSaved = useSelector(selectDidSave);

  useEffect(() => {
    const controller = new AbortController();
    if (shouldShowVersionPicker) {
      coreVersions(undefined, controller.signal).then((vs) =>
        setVersions(vs.coreVersions)
      );
    }
    return controller.abort.bind(controller);
  }, []);

  const [data, setData] = useState<ReleaseMeta>();
  const [showCreateReleaseModal, hideCreateReleaseModal] = useModal(
    () => <ModalReleaseCreate onClose={hideCreateReleaseModal} data={data} />,
    [data]
  );

  const [showUpdateInIndex, hideUpdateInIndex] = useModal(
    () => <ModalReleaseUpdate onClose={hideUpdateInIndex} />,
    []
  );

  const [showPrivateDependencies, hidePrivateDependencies] = useModal(() => (
    <ModalPrivateDependencies onClose={hidePrivateDependencies} />
  ));

  const hasPrivateDependencies = useSelector(
    selectProjectHasPrivateDependencies
  );

  const projectUpdatedAtDate = project
    ? new Date(project.updatedAt)
    : undefined;

  const timeagoDate =
    !projectUpdatedAtDate ||
    projectUpdatedAtDate.getTime() > new Date().getTime()
      ? new Date()
      : projectUpdatedAtDate;

  const isBehaviorProject = project?.type === "Behavior";

  const {
    canLogin,
    canRelease,
    canSave,
    canUseAccount,
    canLinkToProjectInIndex,
  } = useScopes(
    Scope.login,
    Scope.release,
    Scope.save,
    Scope.useAccount,
    Scope.linkToProjectInIndex
  );

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
        {project && canLinkToProjectInIndex ? (
          <a
            href={urljoin(SITE_URL, project.pathWithNamespace)}
            target="_blank"
            className="HashCoreHeader-title-link"
          >
            {title}
          </a>
        ) : (
          title
        )}
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
      <div className="HashCoreHeader__section HashCoreHeader__section--right">
        {!!versions?.length && HashVersionPicker ? (
          <Suspense fallback={null}>
            <HashVersionPicker versions={versions} />
          </Suspense>
        ) : null}
        <div>
          {
            /**
             * We only show last published if you are on main and are able to
             * edit / publish
             */
            project?.latestRelease && canRelease ? (
              <i className="HashCoreHeader-timeago">
                Last released <TimeAgo date={project.latestRelease.createdAt} />
              </i>
            ) : null
          }
          {project ? <HashCoreHeaderShareButton /> : null}
          {project && canRelease ? (
            <button
              className="HashCoreHeader__RightButton"
              onClick={async (evt) => {
                evt.preventDefault();

                if (
                  project?.visibility === "public" &&
                  hasPrivateDependencies
                ) {
                  showPrivateDependencies();
                } else if (project.latestRelease) {
                  showUpdateInIndex();
                } else {
                  setData(await getReleaseMeta());
                  showCreateReleaseModal();
                }
              }}
            >
              Create a{" "}
              {projectIsPrivate(project)
                ? project.ownerType === "Org"
                  ? "shared "
                  : "private "
                : ""}
              release
            </button>
          ) : null}
          {canLogin ? (
            <Link
              className="HashCoreHeader__RightButton HashCoreHeader__RightButton--CTA"
              path="/signup"
            >
              Sign up / Sign in
            </Link>
          ) : null}
        </div>

        {canUseAccount ? <HashCoreHeaderUserImage /> : null}
      </div>
    </header>
  );
};

// // @ts-ignore
// HashCoreHeader.whyDidYouRender = {
//   customName: "HashCoreHeader"
// };
