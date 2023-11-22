import React from "react";
import ReactDOM from "react-dom";

import { ModalTwoColumn } from "./ModalTwoColumn";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <ModalTwoColumn
      title="title"
      intro="intro"
      onSubmit={() => Promise.resolve()}
      leftChildren={null}
      rightChildren={null}
    />,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
