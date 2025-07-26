import React, { FC } from "react";

import { HashCoreConsole } from "../Console";
import { HashCoreEditor } from "../Editor/HashCoreEditor";

import "./HashCoreEditorContainer.css";

export const HashCoreEditorContainer: FC = () => (
  <div className="HashCoreEditorContainer">
    <HashCoreEditor />
    <HashCoreConsole />
  </div>
);
