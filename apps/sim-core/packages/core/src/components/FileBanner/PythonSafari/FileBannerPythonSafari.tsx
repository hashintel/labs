import React, { FC } from "react";

import { IconPython } from "../../Icon";

import "../FileBanner.css";
import "./FileBannerPythonSafari.css";

export const FileBannerPythonSafari: FC = () => (
  <div className="FileBanner FileBannerPythonSafari">
    <IconPython size={51} />
    <p>
      <strong>
        Python behaviors can’t be run locally in-browser using your version of
        Safari.
      </strong>{" "}
      To run this simulation you’ll need to use hCloud, or switch to
      Chrome/Firefox.
    </p>
  </div>
);
