import React, { FC } from "react";

import { IconProps } from "..";

import "../Icon.css";

export const IconMagnify: FC<IconProps> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 18 18"
    className="Icon IconMagnify"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.60938 7.73438C6.60938 5.71506 8.24631 4.07812 10.2656 4.07812C12.2849 4.07812 13.9219 5.71506 13.9219 7.73438C13.9219 9.75369 12.2849 11.3906 10.2656 11.3906C9.35724 11.3906 8.52621 11.0593 7.88676 10.511L7.73438 10.6634V11.1094L4.92188 13.9219L4.07812 13.0781L6.89062 10.2656H7.33663L7.48901 10.1132C6.94069 9.47379 6.60938 8.64276 6.60938 7.73438ZM12.7969 7.73438C12.7969 6.33639 11.6636 5.20312 10.2656 5.20312C8.86764 5.20312 7.73438 6.33639 7.73438 7.73438C7.73438 9.13236 8.86764 10.2656 10.2656 10.2656C11.6636 10.2656 12.7969 9.13236 12.7969 7.73438Z"
    />
  </svg>
);
