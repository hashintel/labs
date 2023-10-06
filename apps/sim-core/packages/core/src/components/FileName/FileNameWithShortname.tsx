import React, { FC } from "react";

import { FileName } from "./FileName";
import {
  FileNameWithShortnameInner,
  FileNameWithShortnameProps,
} from "./FileNameWithShortnameInner";

export const FileNameWithShortname: FC<FileNameWithShortnameProps> = (
  props
) => (
  <FileName>
    <FileNameWithShortnameInner {...props} />
  </FileName>
);
