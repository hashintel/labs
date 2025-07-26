import React, { Dispatch, FC, forwardRef, SetStateAction } from "react";
import classNames from "classnames";

import {
  IconBrain,
  IconChartLineVariant,
  IconCheckboxMarkedCircleOutline,
} from "../../Icon";
import { ResourceProjectType } from "../../../features/project/types";

import "./ResourceListItemButton.css";

interface ResourceListItemButtonProps {
  alreadyPresent: boolean;
  setIsPopoverOpen: Dispatch<SetStateAction<boolean>>;
  resourceName: string;
  resourceType: ResourceProjectType;
}

export const ResourceListItemButtonIcon: FC<{ type: ResourceProjectType }> = ({
  type,
}) => {
  switch (type) {
    case "Behavior":
      return <IconBrain size={30} />;

    case "Dataset":
      return <IconChartLineVariant />;
  }
};

// necessary to use forwardRef for react tiny popover support
export const ResourceListItemButton = forwardRef<
  HTMLButtonElement,
  ResourceListItemButtonProps
>(({ alreadyPresent, setIsPopoverOpen, resourceName, resourceType }, ref) => (
  <button
    className="ResourceListItemButton"
    onClick={() => setIsPopoverOpen(true)}
    title={resourceName}
    ref={ref}
  >
    <div className="ResourceListItemButton__icon">
      {alreadyPresent ? (
        <IconCheckboxMarkedCircleOutline size={28} />
      ) : (
        <ResourceListItemButtonIcon type={resourceType} />
      )}
    </div>
    <div className="ResourceListItemButton__details">
      <div
        className={classNames(
          "ResourceListItemButton__details__line",
          "ResourceListItemButton__details__line--name",
        )}
      >
        {resourceName}
      </div>
      <div
        className={classNames(
          "ResourceListItemButton__details__line",
          "ResourceListItemButton__details__line--kind",
        )}
      >
        {resourceType}
      </div>
    </div>
  </button>
));
