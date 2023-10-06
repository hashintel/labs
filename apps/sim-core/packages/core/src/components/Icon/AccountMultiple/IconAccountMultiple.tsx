import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconAccountMultiple: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconAccountMultiple"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9 11.25A2.244 2.244 0 0011.242 9c0-1.242-1-2.25-2.242-2.25a2.25 2.25 0 000 4.5zm-5.25 4.125c0-1.749 3.5-2.625 5.25-2.625s5.25.876 5.25 2.625v1.875H3.75v-1.875zm10.526-2.585c.261-.026.507-.04.724-.04 1.75 0 5.25.876 5.25 2.625v1.875h-4.5v-1.875c0-1.112-.604-1.957-1.474-2.585zM17.242 9c0 1.242-1 2.25-2.242 2.25a2.25 2.25 0 010-4.5A2.244 2.244 0 0117.242 9z"
    />
  </svg>
);
