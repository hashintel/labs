import React from "react";
import ReactDOM from "react-dom";

import { DataTable } from "./DataTable";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<DataTable headings={[]} records={[]} />, div);
  ReactDOM.unmountComponentAtNode(div);
});
