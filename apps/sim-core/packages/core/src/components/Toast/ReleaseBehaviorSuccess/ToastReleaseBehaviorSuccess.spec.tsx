import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { HcSharedBehaviorFile } from "../../../features/files/types";
import { ToastReleaseBehaviorSuccess } from "./ToastReleaseBehaviorSuccess";
import { parse } from "../../../util/files";
import { store } from "../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ToastReleaseBehaviorSuccess
        files={[{ path: parse("@foo/bar/baz.js") } as HcSharedBehaviorFile]}
      />
    </Provider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
