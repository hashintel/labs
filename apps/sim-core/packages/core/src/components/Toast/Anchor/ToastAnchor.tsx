import React, { FC, PropsWithChildren } from "react";

import { FancyAnchor } from "../../Fancy";
import { FancyAnchorProps } from "../../Fancy/Anchor/FancyAnchor";

type ToastAnchorProps = Pick<FancyAnchorProps, "path" | "icon" | "query">;

export const ToastAnchor: FC<PropsWithChildren<ToastAnchorProps>> = ({
  children,
  icon,
  path,
  query,
}) => (
  <FancyAnchor
    icon={icon}
    size="compact"
    theme="grey"
    style={{ marginLeft: "10px" }}
    path={path}
    query={query}
  >
    <strong>{children}</strong>
  </FancyAnchor>
);
