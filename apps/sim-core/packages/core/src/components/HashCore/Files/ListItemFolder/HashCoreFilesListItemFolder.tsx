import React, { FC, MutableRefObject } from "react";
import classNames from "classnames";

import { FileNameWithIcon } from "../../../FileName/FileNameWithIcon";
import { HashCoreFilesListItem } from "../ListItem/HashCoreFilesListItem";
import { HashCoreFilesListItemFile } from "../";
import { HcFile, HcFolder } from "../../../../features/files/types";

import "./HashCoreFilesListItemFolder.css";

interface HashCoreFilesListItemFolderProps {
  scrollIntoViewRef?: MutableRefObject<VoidFunction | null>;
  childrenItems?: HcFile[] | HcFolder[]; // the files contained in the folder
  name: string; // the name of the current folder
  repoPath: string; // the absolute path to the current folder
  isOpen?: boolean; // whether the current folder is open
  rootFolder?: boolean; // used only in HashCoreFiles to render a "virtual" root folder
  toggleOpen: (path: string) => void;
  openPaths: Record<string, boolean>;
}

export const HashCoreFilesListItemFolder: FC<
  HashCoreFilesListItemFolderProps
> = ({
  scrollIntoViewRef,
  childrenItems = [],
  name,
  repoPath,
  isOpen = false,
  rootFolder = false,
  toggleOpen,
  openPaths,
}) => {
  const folderOpen = isOpen || openPaths[repoPath];
  const folders = childrenItems.filter(
    (item) => item.children && item.children.length > 0,
  );
  const files = childrenItems.filter(
    (item) => item.children && item.children.length === 0,
  );

  const id = `HashCoreFilesListItemFolder-${repoPath.replace(/\//g, "_")}`;
  const depth = repoPath.split("/").length;

  return (
    <li className="HashCoreFilesListItemFolder" id={id} data-testid={id}>
      {rootFolder ? null : (
        <HashCoreFilesListItem
          depth={depth}
          onClick={(evt) => {
            evt.stopPropagation(); // to prevent closing the parent folder
            evt.preventDefault();

            if (!rootFolder) {
              toggleOpen(repoPath);
            }
          }}
        >
          <FileNameWithIcon icon={folderOpen ? "openFolder" : "closedFolder"}>
            {name}
          </FileNameWithIcon>
        </HashCoreFilesListItem>
      )}
      <ul
        className={classNames("HashCoreFilesListItemFolder__Items", {
          "HashCoreFilesListItemFolder__Items--closed": !folderOpen,
        })}
      >
        {folders.map((childrenItem) => (
          <HashCoreFilesListItemFolder
            key={childrenItem.repoPath}
            name={childrenItem.name ?? childrenItem.repoPath}
            repoPath={childrenItem.repoPath}
            childrenItems={childrenItem.children}
            scrollIntoViewRef={scrollIntoViewRef}
            toggleOpen={toggleOpen}
            openPaths={openPaths}
          />
        ))}
        {files.map((childrenItem) => (
          <HashCoreFilesListItemFile
            fileId={childrenItem.id.toString()}
            key={childrenItem.id.toString()}
            scrollIntoViewRef={scrollIntoViewRef}
            depth={childrenItem.repoPath.split("/").length}
          />
        ))}
      </ul>
    </li>
  );
};

// HashCoreFilesListItemFolder.whyDidYouRender = {
//   // @ts-expect-error
//   customName: "HashCoreFilesListItemFolder"
// };
