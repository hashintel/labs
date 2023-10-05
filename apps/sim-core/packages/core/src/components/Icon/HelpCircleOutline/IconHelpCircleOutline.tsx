import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconHelpCircleOutline: FC<IconProps> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    className="Icon IconHelpCircleOutline"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M.5 8C.5 3.86 3.86.5 8 .5c4.14 0 7.5 3.36 7.5 7.5 0 4.14-3.36 7.5-7.5 7.5C3.86 15.5.5 12.14.5 8zm8.25 3v1.5h-1.5V11h1.5zM8 14c-3.308 0-6-2.693-6-6 0-3.308 2.692-6 6-6s6 2.692 6 6c0 3.307-2.692 6-6 6zM5 6.5a3 3 0 116 0c0 .962-.592 1.48-1.17 1.984-.547.478-1.08.944-1.08 1.766h-1.5c0-1.366.707-1.908 1.328-2.384.487-.373.922-.707.922-1.366C9.5 5.675 8.825 5 8 5s-1.5.675-1.5 1.5H5z"
    />
  </svg>
);
