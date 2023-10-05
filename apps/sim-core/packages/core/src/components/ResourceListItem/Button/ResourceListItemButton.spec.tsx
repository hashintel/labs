import React from "react";
import ReactDOM from "react-dom";

import { ResourceListItemButton } from "./ResourceListItemButton";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <ResourceListItemButton
      alreadyPresent={true}
      setIsPopoverOpen={() => {}}
      resourceName="name"
      resourceType="Behavior"
    />,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
