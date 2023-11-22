import React, { FC } from "react";

import { FileNameWithIcon } from "./FileNameWithIcon";
import {
  FileNameWithShortnameInner,
  FileNameWithShortnameProps,
} from "./FileNameWithShortnameInner";

export const FileNameWithShortnameIcon: FC<FileNameWithShortnameProps> = (
  props,
) => (
  <FileNameWithIcon icon="file">
    <FileNameWithShortnameInner {...props} />
  </FileNameWithIcon>
);
