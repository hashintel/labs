import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconAddDatapoint: FC<IconProps> = ({ size = 28 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 28 28"
    xmlns="http://www.w3.org/2000/svg"
    xmlnsXlink="http://www.w3.org/1999/xlink"
    className="Icon IconAddDatapoint"
  >
    <g fillRule="nonzero">
      <path d="M17.172 10.926H10.81v2.386H6.037v1.591h4.772v2.386h6.363v-2.386h4.773v-1.591h-4.773v-2.387.001zM12.4 15.698v-3.181h3.182v3.18H12.4zM25.259 6.551h-2.386v2.386h-.795V6.551H19.69v-.795h2.386V3.37h.795v2.386h2.387v.795z" />
    </g>
  </svg>
);
