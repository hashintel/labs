import React, { FC } from "react";

import { ResourceListItem } from "../../../ResourceListItem";
import { ResourceProject } from "../../../../features/project/types";

import "./HashCoreResourcesList.css";

export interface HashCoreResourcesListProps {
  results: ResourceProject[];
}

export const HashCoreResourcesList: FC<HashCoreResourcesListProps> = ({
  results,
}) => (
  <div className="HashCoreResourcesList">
    {results.map((resource, id) =>
      resource.files.length ? (
        <ResourceListItem key={id} resource={resource} />
      ) : null,
    )}
  </div>
);
