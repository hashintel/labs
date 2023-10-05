import React from "react";
import ReactDOM from "react-dom";

import { Dropdown } from "./Dropdown";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Dropdown options={[]} value={undefined} onChange={() => {}} />,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
