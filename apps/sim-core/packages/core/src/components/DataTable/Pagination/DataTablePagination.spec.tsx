import React from "react";
import ReactDOM from "react-dom";

import { DataTablePagination } from "./DataTablePagination";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <DataTablePagination
      currentPage={0}
      setCurrentPage={() => {}}
      totalPages={1}
    />,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
