import React from "react";
import { render } from "@testing-library/react";

import { DropdownMenuList } from "./DropdownMenuList";

it("renders without crashing", () => {
  render(<DropdownMenuList options={[]} children={[]} />);
});
