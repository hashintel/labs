import React from "react";
import ReactDOM from "react-dom";

import { ToastProvider } from "../../../features/toast/ToastContext";
import { ToastReleaseSuccess } from "./ToastReleaseSuccess";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <ToastProvider>
      <ToastReleaseSuccess
        project={{
          name: "Project",
          pathWithNamespace: "@hash/path",
          latestRelease: { tag: "1.0.0" },
        }}
      />
    </ToastProvider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
