import React, { FC, useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import Popover from "react-tiny-popover";

import { ResourceListItemButton } from "./Button";
import { ResourceListItemPopup } from "./Popup";
import { ResourceProject } from "../../features/project/types";
import type { RootState } from "../../features/types";
import { makeSelectPresentItemsFromResource } from "../HashCore/Resources/selectors";

type ResourceListItemProps = {
  resource: ResourceProject;
};

export const ResourceListItem: FC<ResourceListItemProps> = ({ resource }) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const selectPresentItemsFromResource = useMemo(
    makeSelectPresentItemsFromResource,
    []
  );

  const memoSelector = useCallback(
    (state: RootState) => selectPresentItemsFromResource(state, resource),
    [selectPresentItemsFromResource, resource]
  );

  const presentItems = useSelector<RootState, string[]>(memoSelector);

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
