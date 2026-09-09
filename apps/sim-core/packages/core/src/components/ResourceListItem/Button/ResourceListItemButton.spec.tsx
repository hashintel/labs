import React from "react";
import { render } from "@testing-library/react";

import { ResourceListItemButton } from "./ResourceListItemButton";

it("renders without crashing", () => {
  render(
    <ResourceListItemButton
      alreadyPresent={true}
      setIsPopoverOpen={() => {}}
      resourceName="name"
      resourceType="Behavior"
    />,
  );
});
