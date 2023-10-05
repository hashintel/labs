import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconCreatePlot: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 21"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconCreatePlot"
  >
    <path d="M11.254 11.875l2.381-4.124.974.562-2.943 5.099-3.663-2.115-2.68 4.64h9.302v1.126H3.375V6.938H4.5v8.176L7.591 9.76l3.663 2.115zM20.625 6.375h-2.25v2.25h-.75v-2.25h-2.25v-.75h2.25v-2.25h.75v2.25h2.25v.75z" />
  </svg>
);
