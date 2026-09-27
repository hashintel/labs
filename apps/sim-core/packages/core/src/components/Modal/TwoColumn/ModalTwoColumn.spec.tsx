import React from "react";
import { render } from "@testing-library/react";

import { ModalTwoColumn } from "./ModalTwoColumn";

it("renders without crashing", () => {
  render(
    <ModalTwoColumn
      title="title"
      intro="intro"
      onSubmit={() => Promise.resolve()}
      leftChildren={null}
      rightChildren={null}
    />,
  );
});
