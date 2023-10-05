import React, { FC } from "react";
import classNames from "classnames";

import { IconProps } from "..";

import "../Icon.css";

export const IconDotsHorizontal: FC<IconProps & { className?: string }> = ({
  size = 24,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className={classNames("Icon IconDotsHorizontal", className)}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M7.5 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm3 1.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm4.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z"
    />
  </svg>
);
