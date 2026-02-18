import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { HcSharedBehaviorFile } from "../../../features/files/types";
import { ToastProvider } from "../../../features/toast/ToastContext";
import { ToastReleaseBehaviorSuccess } from "./ToastReleaseBehaviorSuccess";
import { parse } from "../../../util/files";
import { store } from "../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ToastProvider>
        <ToastReleaseBehaviorSuccess
          files={[{ path: parse("@foo/bar/baz.js") } as HcSharedBehaviorFile]}
        />
      </ToastProvider>
    </Provider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
