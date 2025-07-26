import React, { FC } from "react";
import { useSelector } from "react-redux";

import {
  selectUserImage,
  selectUserProfileUrl,
} from "../../../../features/user/selectors";

import "./HashCoreHeaderUserImage.css";

export const HashCoreHeaderUserImage: FC = () => {
  const url = useSelector(selectUserProfileUrl);
  const image = useSelector(selectUserImage);

  if (!url) {
    throw new Error("Cannot display user image without profile to link to");
  }

  return (
    <a
      href={url}
      target="_blank"
      className="HashCoreHeaderUserImage"
      title="My account"
      rel="noreferrer"
    >
      {image ? <img src={image} alt="User profile image" /> : null}
    </a>
  );
};
