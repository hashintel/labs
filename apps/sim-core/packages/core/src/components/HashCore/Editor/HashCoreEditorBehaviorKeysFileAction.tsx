import React from "react";
import { useDispatch } from "react-redux";

import { AppDispatch } from "../../../features/types";
import { HcFileKind } from "../../../features/files/enums";
import { IconBrain } from "../../Icon";
import { SimpleTooltip } from "../../SimpleTooltip";
import { fileActionSize } from "./utils";
import { useFiles } from "../../../features/files/FilesContext";
import { toggleBehaviorKeysEditor } from "../../../features/files/slice";

export const HashCoreEditorBehaviorKeysFileAction = () => {
  const { currentFile } = useFiles();
  const dispatch = useDispatch<AppDispatch>();

  if (
    currentFile?.kind !== HcFileKind.Behavior &&
    currentFile?.kind !== HcFileKind.SharedBehavior
  ) {
    return null;
  }

  return (
    <button
      onClick={async (evt) => {
        evt.preventDefault();

        dispatch(toggleBehaviorKeysEditor({ fileId: currentFile.id }));
      }}
      className="tab-button"
    >
      <IconBrain size={fileActionSize} />
      <SimpleTooltip
        className="TabActionBar__Actions__Tooltip"
        position="below"
        align="right"
      >
        <h4>Toggle Behavior Keys</h4>
        <p>Define the structure of the data your behavior uses</p>
      </SimpleTooltip>
    </button>
  );
};
