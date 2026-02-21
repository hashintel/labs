import React from "react";
import { render } from "@testing-library/react";

import { DataTableCell } from "./DataTableCell";

it("renders without crashing", () => {
  render(
    <table>
      <tbody>
        <tr>
          <DataTableCell cellValue="" />
        </tr>
      </tbody>
    </table>,
  );
});
