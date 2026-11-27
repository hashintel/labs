import React from "react";
import { render } from "@testing-library/react";

import { FileBannerBuiltin } from "./FileBannerBuiltin";

it("renders without crashing", () => {
  render(<FileBannerBuiltin />);
});
