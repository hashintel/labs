import React from "react";
import ReactDOM from "react-dom";

import { HcSharedBehaviorFile } from "../../../features/files/types";
import { ToastProvider } from "../../../features/toast/ToastContext";
import { ToastReleaseBehaviorSuccess } from "./ToastReleaseBehaviorSuccess";
import { parse } from "../../../util/files";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <ToastProvider>
      <ToastReleaseBehaviorSuccess
        files={[{ path: parse("@foo/bar/baz.js") } as HcSharedBehaviorFile]}
      />
    </ToastProvider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
