import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";

import { Ext } from "../../../util/files/enums";
import { FileBannerShared } from "./FileBannerShared";
import type { HcSharedBehaviorFile } from "../../../features/files/types";
import { SimulationProject } from "../../../features/project/types";
import { store } from "../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ModalProvider>
        <FileBannerShared
          project={
            { pathWithNamespace: "@foo/bar", ref: "1.0.0" } as SimulationProject
          }
          file={
            {
              path: {
                ext: Ext.Js,
                name: "test",
                root: "",
                dir: "",
                base: "",
                formatted: "",
              },
              id: "123",
              ref: "1.0.0",
              pathWithNamespace: "@bar/baz",
            } as HcSharedBehaviorFile
          }
        />
      </ModalProvider>
    </Provider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
