import React from "react";
import ReactDOM from "react-dom";

import { DataTableBody } from "./DataTableBody";

it("renders without crashing", () => {
  const table = document.createElement("table");
  ReactDOM.render(<DataTableBody beginIndex={0} records={[]} />, table);
  ReactDOM.unmountComponentAtNode(table);
});
