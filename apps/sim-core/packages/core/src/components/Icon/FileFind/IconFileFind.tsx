import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconFileFind: FC<IconProps> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className="Icon IconFileFind"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18 9v8.692l-2.873-2.88c.39-.592.623-1.297.623-2.062C15.75 10.68 14.07 9 12 9c-2.07 0-3.75 1.68-3.75 3.75a3.751 3.751 0 005.82 3.127l3.322 3.323c-.255.188-.555.3-.892.3H7.492A1.498 1.498 0 016 18l.008-12c0-.825.667-1.5 1.492-1.5h6L18 9zm-6 6a2.247 2.247 0 01-2.25-2.25A2.247 2.247 0 0112 10.5a2.247 2.247 0 012.25 2.25A2.247 2.247 0 0112 15z"
    />
  </svg>
);
