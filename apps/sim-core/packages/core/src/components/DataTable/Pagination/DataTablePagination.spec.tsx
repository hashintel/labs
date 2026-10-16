import React from "react";
import { render } from "@testing-library/react";

import { DataTablePagination } from "./DataTablePagination";

it("renders without crashing", () => {
  render(
    <DataTablePagination
      currentPage={0}
      setCurrentPage={() => {}}
      totalPages={1}
    />,
  );
});
