import React, { FC } from "react";

import { HashCoreAccessGate } from "../HashCore/AccessGate/HashCoreAccessGate";
import { HashCoreSection } from "../HashCore/Section/HashCoreSection";
import { useProject } from "../../features/project/ProjectContext";

import "./EmbedApp.scss";

export const EmbedApp: FC = () => {
  const { projectLoaded, accessGate } = useProject();

  if (accessGate) {
    return <HashCoreAccessGate accessGate={accessGate} embedded />;
  }

  if (!projectLoaded) {
    return null;
  }

  return <HashCoreSection />;
};
