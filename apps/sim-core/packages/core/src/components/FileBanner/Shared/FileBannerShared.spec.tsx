import React from "react";
import ReactDOM from "react-dom";
import { ModalProvider } from "react-modal-hook";

import { Ext } from "../../../util/files/enums";
import { FileBannerShared } from "./FileBannerShared";
import type { HcSharedBehaviorFile } from "../../../features/files/types";
import { SimulationProject } from "../../../features/project/types";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
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
    </ModalProvider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
