import React, { FC } from "react";

import { FileNameWithShortname } from "../../../FileName/FileNameWithShortname";
import { HashCoreFilesSearchItemWithIcons } from "./HashCoreFilesSearchItemWithIcons";
import { HashCoreFilesSearchMatch } from "./HashCoreFilesSearchMatch";
import type { HcFile } from "../../../../features/files/types";
import { MonacoIconButton } from "./MonacoIconComponents";
import type { SearchMatch } from "./types";

import "./HashCoreFilesSearchFile.scss";

interface SearchFileProps {
  file: HcFile;
  matches: SearchMatch[];
  onClick: (match: SearchMatch) => void;
  onFileClick: (file: HcFile) => void;
  onReplace: (match: SearchMatch) => Promise<void>;
  onReplaceAllInFile: () => Promise<void>;
  replacing: boolean;
  pending: boolean;
}

export const HashCoreFilesSearchFile: FC<SearchFileProps> = ({
  file,
  matches,
  onClick,
  onFileClick,
  onReplace,
  onReplaceAllInFile,
  replacing,
  pending,
}) => (
  <div className="HashCoreFilesSearchFile">
    <div
      className="HashCoreFilesSearchFile__Title"
      onClick={(evt) => {
        evt.preventDefault();

        onFileClick(file);
      }}
    >
      <HashCoreFilesSearchItemWithIcons
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        icons={
          replacing ? (
            <MonacoIconButton
              title="Replace all in file"
              iconName="replace-all"
              disabled={pending}
              onClick={async () => {
                await onReplaceAllInFile();
              }}
            />
          ) : null
        }
      >
        <FileNameWithShortname path={file.path} />
      </HashCoreFilesSearchItemWithIcons>
    </div>
    <ul>
      {matches.map((match) => (
        <li key={match.id}>
          <HashCoreFilesSearchMatch
            match={match}
            onClick={onClick}
            onReplace={onReplace}
            replacing={replacing}
            pending={pending}
          />
        </li>
      ))}
    </ul>
  </div>
);
