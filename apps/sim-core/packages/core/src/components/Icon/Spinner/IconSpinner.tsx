import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";
import "./IconSpinner.css";

export const IconSpinner: FC<IconProps> = ({ size = 37 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 33 33"
    className="Icon IconSpinner"
  >
    <path
      d="M8.245 30.724a16.453 16.453 0 1116.468-28.49l-2.47 4.274A11.518 11.518 0 0010.715 26.45l-2.47 4.273z"
      fill="url(#IconSpinnerFill)"
    />
    <defs>
      <linearGradient
        x1="25.456%"
        y1="52.036%"
        x2="42.484%"
        y2="97.641%"
        id="IconSpinnerFill"
      >
        <stop stopColor="#FFF" offset="0%" />
        <stop stopColor="#FFF" stopOpacity={0} offset="100%" />
      </linearGradient>
    </defs>
  </svg>
);
