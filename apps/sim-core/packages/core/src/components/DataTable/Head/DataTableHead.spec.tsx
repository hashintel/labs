import React from "react";
import ReactDOM from "react-dom";

import { DataTableHead } from "./DataTableHead";

it("renders without crashing", () => {
  const table = document.createElement("table");
  ReactDOM.render(<DataTableHead headings={[]} />, table);
  ReactDOM.unmountComponentAtNode(table);
});
