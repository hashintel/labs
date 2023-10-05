import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconFilter: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconFilter"
  >
    <path d="M13.5 11.998v5.912a.749.749 0 01-1.275.622l-1.511-1.511a.749.749 0 01-.214-.624v-4.4h-.02L6.157 6.466a.75.75 0 01.593-1.212v-.005h10.5v.005a.75.75 0 01.593 1.212l-4.324 5.533H13.5z" />
  </svg>
);
