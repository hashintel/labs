import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { HashCoreAccessGateNotFound } from "./HashCoreAccessGateNotFound";
import { store } from "../../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <HashCoreAccessGateNotFound requestedProject={null} embedded={false} />
    </Provider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
