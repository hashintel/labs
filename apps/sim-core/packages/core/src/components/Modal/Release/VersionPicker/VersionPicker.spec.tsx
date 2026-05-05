import React from "react";
import ReactDOM from "react-dom";

import { VersionPicker } from "./VersionPicker";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <VersionPicker
      nextMajorVersion="1.0.0"
      nextMinorVersion="0.1.0"
      nextPatchVersion="0.0.1"
      selectedVersion="1.0.0"
      setSelectedVersion={() => {}}
    />,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
