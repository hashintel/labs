import React from "react";
import { render } from "@testing-library/react";
import { ModalProvider } from "react-modal-hook";

import { Ext } from "../../../util/files/enums";
import { FileBannerShared } from "./FileBannerShared";
import type { HcSharedBehaviorFile } from "../../../features/files/types";
import { SimulationProject } from "../../../features/project/types";

it("renders without crashing", () => {
  render(
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
  );
});
