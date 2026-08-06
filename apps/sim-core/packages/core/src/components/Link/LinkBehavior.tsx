import React, { FC, PropsWithChildren } from "react";

import { HcSharedBehaviorFile } from "../../features/files/types";
import { Link, LinkProps } from "./Link";
import { mainProjectPath } from "../../routes";
import { mapFileId } from "../../features/files/utils";

export const LinkBehavior: FC<
  PropsWithChildren<
    Omit<LinkProps, "path" | "query"> & { file: HcSharedBehaviorFile }
  >
> = ({ children, file, ...props }) => (
  <Link
    {...props}
    path={mainProjectPath(file.pathWithNamespace)}
    query={{ file: mapFileId(file.path.base) }}
  >
    {children}
  </Link>
);
