import React from "react";
import ReactDOM from "react-dom";

import { DataTableCell } from "./DataTableCell";

it("renders without crashing", () => {
  const tr = document.createElement("tr");
  ReactDOM.render(<DataTableCell cellValue="" />, tr);
  ReactDOM.unmountComponentAtNode(tr);
});
