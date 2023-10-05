import React, { FC } from "react";

import { IconRust } from "../../Icon";

import "../FileBanner.css";
import "./FileBannerBuiltin.css";

export const FileBannerBuiltin: FC = () => (
  <div className="FileBanner FileBannerBuiltin">
    <IconRust size={51} />
    <p>
      <strong>
        This imported behavior is only available in read-only mode at this time.
      </strong>{" "}
      Support for editing Rust behaviors in-IDE is coming soon.
    </p>
  </div>
);
