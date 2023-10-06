import React, { FC } from "react";

import { FileName } from "../../../FileName/FileName";

import "./HashCoreFilesListItemFile.scss";

export const HashCoreFilesListItemFilePending: FC = () => (
  <li className="HashCoreFilesListItemFile">
    <FileName className="HashCoreFilesListItemFile__Pending">
      <span>Loading…</span>
    </FileName>
  </li>
);
