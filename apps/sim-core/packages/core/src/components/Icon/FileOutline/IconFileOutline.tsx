import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconFileOutline: FC<IconProps> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconFileOutline"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M5.625 3.375h4.5L13.5 6.75v6.75c0 .621-.504 1.125-1.125 1.125H5.619A1.12 1.12 0 014.5 13.5l.006-9a1.12 1.12 0 011.119-1.125zm3.938 3.938h3.093L9.562 4.219v3.093zM5.624 4.5h2.813V8.44h3.937V13.5h-6.75v-9z"
    />
  </svg>
);
