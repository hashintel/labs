import React, { FC, ButtonHTMLAttributes } from "react";

import { IconSync } from "../../Icon";

import "../FileBanner.css";
import "./FileBannerUpgrade.css";

type FileBannerUpgradeProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
>;

export const FileBannerUpgrade: FC<FileBannerUpgradeProps> = ({ onClick }) => (
  <button className="FileBanner FileBannerUpgrade" onClick={onClick}>
    <IconSync size={51} />
    <div>
      <p>
        <strong>This behavior has been updated by its publisher.</strong>
      </p>
      <p>Click here to preview changes and choose whether to upgrade.</p>
    </div>
  </button>
);
