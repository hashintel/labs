import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconEarth: FC<IconProps> = ({ size = 23 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 23 23"
    className="Icon IconEarth"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4.313 11.5a7.187 7.187 0 1114.374 0 7.187 7.187 0 01-14.375 0zm11.425 3.876a1.433 1.433 0 00-1.363-1.001h-.719v-2.156a.719.719 0 00-.719-.719H8.625v-1.438h1.438a.719.719 0 00.718-.718V7.906h1.438c.793 0 1.437-.644 1.437-1.437v-.297A5.749 5.749 0 0117.25 11.5a5.72 5.72 0 01-1.512 3.876zM10.78 17.2a5.747 5.747 0 01-5.031-5.7c0-.444.055-.873.15-1.288l3.444 3.444v.719c0 .793.643 1.438 1.437 1.438V17.2z"
    />
  </svg>
);
