import React from "react";
import ReactDOM from "react-dom";

import { DataTableRow } from "./DataTableRow";

it("renders without crashing", () => {
  const tbody = document.createElement("tbody");
  ReactDOM.render(<DataTableRow rowIndex={0} record={[]} />, tbody);
  ReactDOM.unmountComponentAtNode(tbody);
});
