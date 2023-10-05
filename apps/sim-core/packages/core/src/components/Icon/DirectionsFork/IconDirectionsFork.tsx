import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconDirectionsFork: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconDirectionsFork"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M5.249 12V5.624h6.375L9.75 7.562l2.253 2.563s.7.75 1.098 1.502c.4.746.4 1.497.4 1.497v5.252h-3v-4.501s0-.751-.75-1.502L7.5 9.752 5.25 12zm7.903-3.025l3.347-3.35 2.252 2.252-3.845 3.845a3.275 3.275 0 00-.304-.846c-.403-.751-1.103-1.502-1.103-1.502l-.347-.4z"
    />
  </svg>
);
