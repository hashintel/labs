import React, { FC, useMemo, useState } from "react";
import Popover from "react-tiny-popover";

import { ResourceListItemButton } from "./Button";
import { ResourceListItemPopup } from "./Popup";
import { ResourceProject } from "../../features/project/types";
import { makeSelectPresentItemsFromResource } from "../HashCore/Resources/selectors";
import { useFilesSelector } from "../../features/files/FilesContext";

type ResourceListItemProps = {
  resource: ResourceProject;
};

export const ResourceListItem: FC<ResourceListItemProps> = ({ resource }) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const selectPresentItemsFromResource = useMemo(
    makeSelectPresentItemsFromResource,
    []
  );

  const presentItems = useFilesSelector(
    (state) => selectPresentItemsFromResource(state, resource)
  );

  return (
    <Popover
      isOpen={isPopoverOpen}
      position="right"
      windowBorderPadding={40}
      onClickOutside={() => setIsPopoverOpen(false)}
      containerClassName="react-tiny-popover-container ResourceListItemPopup-Container"
      content={({ position, targetRect, popoverRect }) => (
        <ResourceListItemPopup
          position={position}
          targetRect={targetRect}
          popoverRect={popoverRect}
          resource={resource}
          presentItems={presentItems}
        />
      )}
    >
      {(ref) => (
        <ResourceListItemButton
          alreadyPresent={presentItems.length > 0}
          setIsPopoverOpen={setIsPopoverOpen}
          resourceName={resource.name}
          resourceType={resource.type}
          ref={ref}
        />
      )}
    </Popover>
  );
};
