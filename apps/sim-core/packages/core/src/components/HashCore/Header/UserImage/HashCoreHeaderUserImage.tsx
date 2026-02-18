import React, { FC } from "react";

import { useUser } from "../../../../features/user/UserContext";

import "./HashCoreHeaderUserImage.css";

export const HashCoreHeaderUserImage: FC = () => {
  const { userProfileUrl: url, userImage: image } = useUser();

  if (!url) {
    throw new Error("Cannot display user image without profile to link to");
  }

  return (
    <a
      href={url}
      target="_blank"
      className="HashCoreHeaderUserImage"
      title="My account"
    >
      {image ? <img src={image} alt="User profile image" /> : null}
    </a>
  );
};
