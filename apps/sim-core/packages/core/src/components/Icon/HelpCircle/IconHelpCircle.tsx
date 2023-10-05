import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconHelpCircle: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconHelpCircle"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4.5 12a7.5 7.5 0 1115 0c0 4.143-3.357 7.5-7.5 7.5A7.5 7.5 0 014.5 12zm9.8-.56l-.671.689c-.543.543-.879.996-.879 2.121h-1.5v-.375c0-.828.336-1.578.879-2.121l.932-.944A1.5 1.5 0 1010.5 9.75H9a3 3 0 016 0c0 .66-.267 1.258-.7 1.69zm-3.05 5.81v-1.5h1.5v1.5h-1.5z"
    />
  </svg>
);
