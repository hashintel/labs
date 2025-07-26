import React from "react";
import ReactDOM from "react-dom";

import { DropdownMenuList } from "./DropdownMenuList";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<DropdownMenuList options={[]}>{[]}</DropdownMenuList>, div);
  ReactDOM.unmountComponentAtNode(div);
});
