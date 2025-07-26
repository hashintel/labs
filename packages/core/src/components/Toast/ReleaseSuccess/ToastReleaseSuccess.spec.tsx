import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { ToastReleaseSuccess } from "./ToastReleaseSuccess";
import { store } from "../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ToastReleaseSuccess
        project={{
          name: "Project",
          pathWithNamespace: "@hash/path",
          latestRelease: { tag: "1.0.0" },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
