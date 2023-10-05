import React, { ChangeEvent, FC, memo, MouseEvent, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useModal } from "react-modal-hook";
import urljoin from "url-join";

import { IconBrain } from "../../../../Icon/Brain";
import { IconLock } from "../../../../Icon/Lock";
import { LabeledInputRadio } from "../../../../LabeledInputRadio";
import { Link } from "../../../../Link/Link";
import { ModalNewDataset } from "../../../../Modal/NewDataset/ModalNewDataset";
import { PartialSimulationProject } from "../../../../../features/project/types";
import { SITE_URL } from "../../../../../util/api/paths";
import { Scope, useScope } from "../../../../../features/scopes";
import {
  createMergeRequestUrl,
  forkUrlFromProject,
  mainProjectPath,
  urlFromProject,
} from "../../../../../routes";
import { descByUpdatedAt } from "../../../../../util/descByUpdatedAt";
import { getMetaCharacter } from "../../../../../hooks/useKeyboardShortcuts";
import { selectCurrentProject } from "../../../../../features/project/selectors";
import { selectUserProfileUrl } from "../../../../../features/user/selectors";
import { trackEvent } from "../../../../../features/analytics";
import {
  useExportFiles,
  useImportFiles,
} from "../../../../../features/files/hooks";
import { useNameNewBehaviorModal } from "../../../Files/hooks";
import { useSaveOrFork } from "../../../../../hooks/useSaveOrFork";

type HashCoreHeaderMenuFilesProps = {
  openMenuItem: string;
  openSubmenuItem: string;
  clearAll: () => void;
  onClickMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterSubmenuItemLabel: ({
    target,
  }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterSubmenuItem: ({ target }: MouseEvent<HTMLLIElement>) => void;
  onMouseLeaveSubmenuItem: ({ target }: MouseEvent<HTMLLIElement>) => void;
  userProjects: PartialSimulationProject[];
  exampleProjects: PartialSimulationProject[];
};

/**
 * @todo most of these props do not need to be props – define them locally instead
 */
export const HashCoreHeaderMenuFiles: FC<HashCoreHeaderMenuFilesProps> = memo(
  ({
    openMenuItem,
    openSubmenuItem,
    clearAll,
    onClickMenuItemLabel,
    onMouseEnterMenuItemLabel,
    onMouseEnterSubmenuItemLabel,
    onMouseEnterSubmenuItem,
    onMouseLeaveSubmenuItem,
    userProjects,
    exampleProjects,
  }) => {
    const userProfileUrl = useSelector(selectUserProfileUrl);
    const project = useSelector(selectCurrentProject);
    const dispatch = useDispatch();
    const forkUrl = project ? forkUrlFromProject(project) : null;

    const showModalNewBehavior = useNameNewBehaviorModal();
    const [showNewDatasetModal, hideNewDatasetModal] = useModal(
      () => <ModalNewDataset onClose={hideNewDatasetModal} />,
      []
    );

    const exportFiles = useExportFiles();
    const importFiles = useImportFiles();
    const importFileRef = useRef<HTMLInputElement | null>(null);
    const onImportClick = () => {
      importFileRef.current?.click();
    };

    const [
      saveOrFork,
      canSaveOrFork,
      requireLoginToSaveOrFork,
      { canSave, canFork, canForkIfSignedIn },
    ] = useSaveOrFork();
    const canLinkToProjectInIndex = useScope(Scope.linkToProjectInIndex);
    const isFork = !!project?.forkOf;
    const mergeRequestUrl =
      project && isFork ? createMergeRequestUrl(project) : "";

    const toListItem = (type: "Example" | "User") => (
      item: PartialSimulationProject
    ) => {
      const href =
        type === "User"
          ? mainProjectPath(item.pathWithNamespace)
          : urlFromProject(item);

      return (
        <li key={href}>
          <Link
            path={href}
            onClick={() => {
              dispatch(
                trackEvent({
                  action: "Open project",
                  label: `${type} - ${item.pathWithNamespace} - ${item.ref} - From menu`,
                  context: {
                    type,
                  },
                })
              );

              clearAll();
            }}
            className="HashCoreHeaderMenuProjectLink"
          >
            <span>{item.name}</span>
            {item.visibility === "private" ? <IconLock size={16} /> : null}
            {item.type === "Behavior" ? <IconBrain size={24} /> : null}
          </Link>
        </li>
      );
    };

    return (
      <>
        <LabeledInputRadio
          group="HashCoreHeaderMenu"
          label="File"
          isChecked={(htmlFor) => htmlFor === openMenuItem}
          onClick={onClickMenuItemLabel}
          onMouseEnter={onMouseEnterMenuItemLabel}
        />
        <ul className="HashCoreHeaderMenu-submenu">
          {project && canSave && (
            <li className="HashCoreHeaderMenu-submenu-item">
              <LabeledInputRadio
                group="HashCoreHeaderMenu-submenu"
                label="New file"
                isChecked={(htmlFor) => htmlFor === openSubmenuItem}
                onMouseEnter={onMouseEnterSubmenuItemLabel}
              />
              <ul>
                <Link
                  scope={Scope.save}
                  onClick={() => {
                    showModalNewBehavior();
                    clearAll();
                  }}
                >
                  New behavior
                </Link>
                <Link
                  scope={Scope.uploadDataset}
                  onClick={() => {
                    showNewDatasetModal();
                    clearAll();
                  }}
                >
                  New dataset
                </Link>
              </ul>
            </li>
          )}
          <li className="HashCoreHeaderMenu-submenu-item">
            <LabeledInputRadio
              group="HashCoreHeaderMenu-submenu"
              label="New project"
              isChecked={(htmlFor) => htmlFor === openSubmenuItem}
              onMouseEnter={onMouseEnterSubmenuItemLabel}
            />
            <ul>
              <Link
                scope={Scope.newProject}
                path="/new"
                onClick={() => {
                  clearAll();
                }}
              >
                Empty simulation
              </Link>
              <Link
                scope={Scope.newProject}
                path="/new/starter"
                onClick={() => {
                  clearAll();
                }}
              >
                From starter template
              </Link>
            </ul>
          </li>
          <li>
            <hr />
          </li>
          {userProjects.length ? (
            <li
              className="HashCoreHeaderMenu-submenu-item"
              onMouseEnter={onMouseEnterSubmenuItem}
              onMouseLeave={onMouseLeaveSubmenuItem}
            >
              <LabeledInputRadio
                group="HashCoreHeaderMenu-submenu"
                label="My recent projects"
                isChecked={(htmlFor) => htmlFor === openSubmenuItem}
                onMouseEnter={onMouseEnterSubmenuItemLabel}
              />
              <ul>
                {[...userProjects]
                  .sort(descByUpdatedAt)
                  .slice(0, 10)
                  .map(toListItem("User"))}
                {userProfileUrl ? (
                  <>
                    {userProjects.length ? (
                      <li>
                        <hr />
                      </li>
                    ) : null}
                    <li>
                      <a href={userProfileUrl} target="_blank">
                        My projects
                      </a>
                    </li>
                  </>
                ) : null}
              </ul>
            </li>
          ) : null}
          {exampleProjects.length ? (
            <li
              className="HashCoreHeaderMenu-submenu-item"
              onMouseEnter={onMouseEnterSubmenuItem}
              onMouseLeave={onMouseLeaveSubmenuItem}
            >
              <LabeledInputRadio
                group="HashCoreHeaderMenu-submenu"
                label="Example projects"
                isChecked={(htmlFor) => htmlFor === openSubmenuItem}
                onMouseEnter={onMouseEnterSubmenuItemLabel}
              />
              <ul>
                {[...exampleProjects]
                  .sort(descByUpdatedAt)
                  .map(toListItem("Example"))}
              </ul>
            </li>
          ) : null}
          <li className="HashCoreHeaderMenu-submenu-item">
            <input
              type="file"
              accept=".zip"
              ref={importFileRef}
              style={{ display: "none" }}
              onChange={async (evt: ChangeEvent<HTMLInputElement>) => {
                evt.preventDefault();
                clearAll();
                const files = evt.currentTarget.files;
                if (files) {
                  importFiles(files).catch((err) =>
                    console.error(
                      `Error importing project files: ${err.message}`
                    )
                  );
                }
              }}
            />
            <Link forceLogin={false} onClick={onImportClick}>
              Import project
            </Link>
          </li>
          <li>
            <hr />
          </li>
          <li className="HashCoreHeaderMenu-submenu-item">
            {project && canSaveOrFork ? (
              <Link
                forceLogin={requireLoginToSaveOrFork}
                onClick={async (evt: MouseEvent<HTMLAnchorElement>) => {
                  evt.preventDefault();
                  clearAll();
                  await saveOrFork();
                }}
              >
                <div className="HashCoreHeaderMenu__LabelWithHint">
                  <span>Save project</span>
                  <div className="HashCoreHeaderMenu__LabelWithHint__Hint">
                    <span>{getMetaCharacter()}</span>
                    <span>S</span>
                  </div>
                </div>
              </Link>
            ) : null}
          </li>
          {project && forkUrl && (canFork || canForkIfSignedIn) ? (
            <li className="HashCoreHeaderMenu-submenu-item">
              <Link
                scope={Scope.fork}
                path={forkUrl}
                onClick={() => {
                  clearAll();
                }}
              >
                Fork project
              </Link>
            </li>
          ) : null}
          {project ? (
            <li className="HashCoreHeaderMenu-submenu-item">
              <Link
                forceLogin={!userProfileUrl}
                onClick={async (evt: MouseEvent<HTMLAnchorElement>) => {
                  evt.preventDefault();
                  clearAll();
                  exportFiles().catch((err) =>
                    console.error(
                      `Error exporting project files: ${err.message}`
                    )
                  );
                }}
              >
                Export project
              </Link>
            </li>
          ) : null}
          <li>
            <hr />
          </li>
          {project && isFork ? (
            <li className="HashCoreHeaderMenu-submenu-item">
              <Link path={mergeRequestUrl} target="_blank">
                Create merge request
              </Link>
            </li>
          ) : null}
          {project && canLinkToProjectInIndex ? (
            <li className="HashCoreHeaderMenu-submenu-item">
              <a
                href={urljoin(SITE_URL, project.pathWithNamespace)}
                target="_blank"
              >
                View project in HASH
              </a>
            </li>
          ) : null}
        </ul>
      </>
    );
  }
);

// // @ts-ignore
// HashCoreHeaderMenuFiles.whyDidYouRender = {
//   customName: "HashCoreHeaderMenuFiles"
// };
