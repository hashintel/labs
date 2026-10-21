import React, { FC, PropsWithChildren } from "react";

import { useViewer } from "../../features/viewer/ViewerContext";

export const PlotViewerTitleContainer: FC<PropsWithChildren> = ({
  children,
}) => {
  const { embedded } = useViewer();

  return embedded ? null : <div className="PlotViewer__Header">{children}</div>;
};
