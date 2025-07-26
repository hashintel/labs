import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconSparkles: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconSparkles"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M17.25 3.751l-.942 2.058-2.057.941 2.057.942.942 2.057.94-2.057 2.059-.942-2.058-.94-.941-2.059zm-7.5 2.248l-1.88 4.12-4.119 1.883 4.12 1.878L9.75 18l1.878-4.12 4.124-1.878-4.124-1.882L9.75 6zm6.558 10.31l.942-2.059.94 2.058 2.059.942-2.058.94-.941 2.059-.942-2.058-2.057-.941 2.057-.942z"
    />
  </svg>
);
