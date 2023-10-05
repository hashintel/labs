import React, { FC } from "react";

import { HashCoreResourcesSearchableIndex } from ".";

import "./HashCoreResources.css";

export const HashCoreResources: FC = () => (
  <div className="HashCoreResources">
    <h1 className="HashCoreResources__h1">Add to Project</h1>
    <HashCoreResourcesSearchableIndex />
  </div>
);
