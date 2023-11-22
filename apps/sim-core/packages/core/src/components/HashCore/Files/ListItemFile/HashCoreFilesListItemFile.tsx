import React, {
  CSSProperties,
  FC,
  MutableRefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import { useModal } from "react-modal-hook";
import urljoin from "url-join";

import { AppDispatch } from "../../../../features/types";
import { Ext } from "../../../../util/files/enums";
import { FileNameWithShortnameIcon } from "../../../FileName/FileNameWithShortnameIcon";
import { HashCoreContextMenu } from "../../ContextMenu";
import { HashCoreFilesListItem } from "../ListItem/HashCoreFilesListItem";
import { HcFileKind } from "../../../../features/files/enums";
import { IconAccountMultiple, IconTrash } from "../../../Icon";
import { LinkBehavior } from "../../../Link/LinkBehavior";
import { ModalConfirmFileDelete, ModalReleaseBehavior } from "../../../Modal";
import { ReleaseMeta } from "../../../../util/api/types";
import { SITE_URL } from "../../../../util/api/paths";
import { Scope, useScope } from "../../../../features/scopes";
import {
  deleteFile,
  renameInitFile,
  setCurrentFileId,
  updateFile,
} from "../../../../features/files/slice";
import { getReleaseMeta } from "../../../../util/api";
import { isSharedDependency } from "../../../../features/files/utils";
import {
  selectCurrentProject,
  selectProjectPublishedFiles,
} from "../../../../features/project/selectors";
import { useClipboardWriteText } from "../../../../hooks/useClipboardWriteText";
import {
  useFileIsCurrent,
  useSelectFileById,
} from "../../../../features/files/hooks";
import { useOnClickOutside } from "../../../../hooks/useOnClickOutside";
import { useRenameBehaviorModal } from "..";

import "./HashCoreFilesListItemFile.scss";

interface HashCoreFilesListItemFileProps {
  fileId: string;
  scrollIntoViewRef?: MutableRefObject<VoidFunction | null>;
  depth?: number;
}

export const getDomIdByFileId = (id: string) => `HashCoreFilesListItem-${id}`;

export const HashCoreFilesListItemFile: FC<HashCoreFilesListItemFileProps> = ({
  fileId,
  scrollIntoViewRef,
  depth = 1,
}) => {
  const file = useSelectFileById(fileId);
  const dispatch = useDispatch<AppDispatch>();
  const publishedFiles = useSelector(selectProjectPublishedFiles);
  const canSave = useScope(Scope.save);
  const project = useSelector(selectCurrentProject);
  const current = useFileIsCurrent(fileId);
  const clipboardWriteText = useClipboardWriteText();

  const fileIsBehavior = file.kind === HcFileKind.Behavior;
  const filePublished =
    fileIsBehavior && publishedFiles.includes(file.path.formatted);
  const canRename = canSave && fileIsBehavior && !filePublished;
  const canPublish = canRename && project?.visibility === "public";
  const canDelete =
    canSave &&
    file.kind !== HcFileKind.Required &&
    file.kind !== HcFileKind.Init &&
    !filePublished;

  const title = file.path?.formatted ?? "";
  const [showConfirmDelete, hideConfirmDelete] = useModal(
    () => (
      <ModalConfirmFileDelete
        fileName={title}
        onAnswer={(confirm) => {
          if (confirm) {
            dispatch(deleteFile(file.id));
          } else {
            hideConfirmDelete();
          }
        }}
      />
    ),
    [title, dispatch, file.id],
  );

  const [data, setData] = useState<ReleaseMeta | null>(null);
  const [showReleaseBehaviorModal, hideReleaseBehaviorModal] = useModal(
    () =>
      data && file.kind === HcFileKind.Behavior ? (
        <ModalReleaseBehavior
          onHide={hideReleaseBehaviorModal}
          data={data}
          file={file}
        />
      ) : null,
    [data, file],
  );

  const showNameBehavior = useRenameBehaviorModal(file.id, file.path);

  const [contextMenuStyle, setContextMenuStyle] = useState<
    Pick<CSSProperties, "top" | "left">
  >({
    top: 0,
    left: 0,
  });
  const [showContextMenu, hideContextMenu] = useModal(
    () => (
      <HashCoreContextMenu style={contextMenuStyle}>
        {canSave && canPublish && (
          <li>
            <button
              onClick={async () => {
                setData(await getReleaseMeta());
                showReleaseBehaviorModal();
              }}
            >
              Publish a release of this behavior
            </button>
          </li>
        )}
        {isSharedDependency(file) ? (
          <>
            <li>
              <a
                href={urljoin(SITE_URL, file.pathWithNamespace)}
                target="_blank"
                rel="noreferrer"
              >
                View in HASH
              </a>
            </li>
            {file.kind === HcFileKind.SharedBehavior &&
            file.path.ext !== Ext.Rs ? (
              <li>
                <LinkBehavior file={file}>
                  {file.canUserEdit ? <>Edit</> : <>View</>} behavior in
                  original context
                </LinkBehavior>
              </li>
            ) : null}
          </>
        ) : null}
        <li>
          <button
            onClick={
              file.path?.formatted
                ? () => clipboardWriteText(file.path.formatted)
                : undefined
            }
          >
            Copy path to clipboard
          </button>
        </li>
        {canRename && (
          <li>
            <button onClick={showNameBehavior}>Rename</button>
          </li>
        )}
        {canDelete && (
          <li>
            <button onClick={showConfirmDelete}>Delete</button>
          </li>
        )}
        {file.kind === HcFileKind.Init && file.path.ext !== Ext.Js && (
          <li>
            <button
              onClick={() => {
                if (file.path.ext === Ext.Json) {
                  const contents = initJsonToJs(file.contents);
                  dispatch(updateFile({ id: file.id, contents }));
                }
                dispatch(renameInitFile({ id: file.id, newName: "init.js" }));
              }}
            >
              Convert to init.js
            </button>
          </li>
        )}
        {file.kind === HcFileKind.Init && file.path.ext !== Ext.Py && (
          <li>
            <button
              onClick={() => {
                if (file.path.ext === Ext.Json) {
                  const contents = initJsonToPy(file.contents);
                  dispatch(updateFile({ id: file.id, contents }));
                }
                dispatch(renameInitFile({ id: file.id, newName: "init.py" }));
              }}
            >
              Convert to init.py
            </button>
          </li>
        )}
        {file.kind === HcFileKind.Init && file.path.ext !== Ext.Json && (
          <li>
            <button
              onClick={() => {
                dispatch(renameInitFile({ id: file.id, newName: "init.json" }));
              }}
            >
              Convert to init.json
            </button>
          </li>
        )}
      </HashCoreContextMenu>
    ),
    [
      clipboardWriteText,
      contextMenuStyle,
      canDelete,
      file,
      canPublish,
      canSave,
      canRename,
      showConfirmDelete,
      showNameBehavior,
      showReleaseBehaviorModal,
      dispatch,
    ],
  );

  const listItemRef = useRef<HTMLLIElement>(null);

  useOnClickOutside(listItemRef, hideContextMenu);

  useEffect(() => {
    if (current) {
      const resize = () => {
        listItemRef.current?.scrollIntoView({ block: "nearest" });
      };

      resize();

      if (scrollIntoViewRef) {
        scrollIntoViewRef.current = resize;
      }
    }
  }, [current, scrollIntoViewRef]);

  return (
    <li
      className="HashCoreFilesListItemFile"
      id={
        // @see useDomElementForFileId
        getDomIdByFileId(file.id)
      }
      onClick={(evt) => {
        evt.stopPropagation(); // needed to avoid collapsing the parent folder
        evt.preventDefault();
        dispatch(setCurrentFileId(fileId));
      }}
      onContextMenu={(evt) => {
        evt.preventDefault();

        setContextMenuStyle({
          top: evt.pageY - 4,
          left: evt.pageX + 4,
        });

        showContextMenu();
      }}
      ref={listItemRef}
    >
      <HashCoreFilesListItem depth={depth}>
        <FileNameWithShortnameIcon current={current} path={file.path} />
        {filePublished ? (
          <div className="HashCoreFilesListItemFile__SharedBehaviorIndicator">
            <IconAccountMultiple size={16} />
          </div>
        ) : null}
        {canDelete && (
          <div
            aria-hidden
            role="button"
            className="HashCoreFilesListItemFile__Delete"
            onClick={(event) => {
              event.stopPropagation();
              showConfirmDelete();
            }}
          >
            <div className="HashCoreFilesListItemFile__Delete__Fade" />
            <IconTrash size={18} />
          </div>
        )}
      </HashCoreFilesListItem>
    </li>
  );
};

// HashCoreFilesListItem.whyDidYouRender = {
//   // @ts-ignore
//   customName: "HashCoreFilesListItem"
// };

const initJSHeader =
  "/**\n" + " * @param {InitContext} context for initialization\n" + " */";

// Converts the contents of a JSON init file to a JavaScript init file. It creates the
// init function and places the JSON contents into the function's body.
const initJsonToJs = (contents: string) => {
  const body = contents.replaceAll("\n", "\n  ").trim();
  return `${initJSHeader}\nconst init = (context) => {\n  let agents = ${body};\n  return agents;\n}\n`;
};

// Converts the contents of a JSON init file to a Python init file. It creates the
// init function and places the JSON contents into the function's body.
const initJsonToPy = (contents: string) => {
  const body = contents.replaceAll("\n", "\n  ").trim();
  return `def init(context):\n  agents = ${body}\n  return agents\n`;
};
