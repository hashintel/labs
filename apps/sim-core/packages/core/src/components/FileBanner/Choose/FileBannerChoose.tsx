import React, { FC, ReactNode } from "react";

import { FancyButton } from "../../Fancy";

import "../FileBanner.css";
import "./FileBannerChoose.css";

interface FileBannerChooseProps {
  labelA: ReactNode;
  onChooseA: () => void;
  labelB: ReactNode;
  onChooseB: () => void;
}

export const FileBannerChoose: FC<FileBannerChooseProps> = ({
  labelA,
  onChooseA,
  labelB,
  onChooseB,
}) => (
  <div className="FileBanner FileBannerChoose">
    <FancyButton onClick={onChooseA} icon="cancel">
      <strong>{labelA}</strong>
    </FancyButton>
    <FancyButton onClick={onChooseB} icon="sparkles">
      <strong>{labelB}</strong>
    </FancyButton>
  </div>
);
