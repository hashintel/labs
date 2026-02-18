import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { ToastProvider } from "../../../features/toast/ToastContext";
import { ToastReleaseSuccess } from "./ToastReleaseSuccess";
import { store } from "../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ToastProvider>
        <ToastReleaseSuccess
          project={{
            name: "Project",
            pathWithNamespace: "@hash/path",
            latestRelease: { tag: "1.0.0" },
          }}
        />
      </ToastProvider>
    </Provider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
