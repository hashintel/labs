import React, { FC } from "react";
import classnames from "classnames";

import type { ParsedPath } from "../../util/files/types";

import "./FileNameWithShortnameInner.css";

export type FileNameWithShortnameProps = {
  current?: boolean;
  path: ParsedPath;
  hasTitle?: boolean;
};

export const FileNameWithShortnameInner: FC<FileNameWithShortnameProps> = ({
  current = false,
  path,
  hasTitle = true,
}) => (
  <span
    title={hasTitle ? path.formatted : undefined}
    className="FileNameWithShortname"
  >
    <span
      className={classnames({
        FileNameWithShortname__filename: true,
        "FileNameWithShortname__filename--current": current,
      })}
    >
      {path.name}
    </span>
    <span className="FileNameWithShortname__meta">
      {path.ext}
      {path.root || path.dir ? (
        <>
          {" "}
          -{" "}
          <span className="FileNameWithShortname__shortname">
            {path.root}
            {path.dir}
          </span>
        </>
      ) : null}
    </span>
  </span>
);
