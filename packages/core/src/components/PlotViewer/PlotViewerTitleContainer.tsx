import React, { FC } from "react";
import { useSelector } from "react-redux";

import { selectEmbedded } from "../../features/viewer/selectors";

export const PlotViewerTitleContainer: FC = ({ children }) => {
  const embedded = useSelector(selectEmbedded);

  return embedded ? null : <div className="PlotViewer__Header">{children}</div>;
};
