import { v4 as uuid } from "uuid";

import { ApiCommitAction } from "./types";
import { CommitActionVerb } from "./types";
import { FileAction } from "../../features/files/types";

export const graphqlUuid = () => `_${uuid().replace(/-/g, "_")}`;
export const toRepoCommitAction = (action: FileAction) => {
  const partial: ApiCommitAction = {
    action: action.type as CommitActionVerb,
    content: action.contents,
    filePath: action.repoPath,
  };

  if (action.type === "move") {
    partial.previousPath = action.oldRepoPath;
  }

  return partial;
};
