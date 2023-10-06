import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconUpload: FC<IconProps> = ({ size = 115 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 115 115"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconUpload"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M46.719 52.11v21.562H68.28V52.109h14.375L57.5 26.953 32.344 52.11h14.375zM32.344 80.86v7.187h50.312V80.86H32.344z"
    />
  </svg>
);
