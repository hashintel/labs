import React, { FC } from "react";
import { useSelector } from "react-redux";

import { HashCoreAccessGate } from "../HashCore/AccessGate/HashCoreAccessGate";
import { HashCoreSection } from "../HashCore/Section/HashCoreSection";
import {
  selectAccessGate,
  selectProjectLoaded,
} from "../../features/project/selectors";

import "./EmbedApp.scss";

export const EmbedApp: FC = () => {
  const projectLoaded = useSelector(selectProjectLoaded);
  const accessGate = useSelector(selectAccessGate);

  if (accessGate) {
    return <HashCoreAccessGate accessGate={accessGate} embedded />;
  }

  if (!projectLoaded) {
    return null;
  }

  return <HashCoreSection />;
};
