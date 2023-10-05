import React from "react";

import { IconInformationOutline } from "../../Icon";
import { Link } from "../../Link/Link";

import "../FileBanner.css";
import "./FileBannerSignIn.css";

export const FileBannerSignIn = () => (
  <Link path="/signin" className="FileBanner FileBannerSignIn">
    <IconInformationOutline size={51} />
    <p>
      <strong>You cannot edit this file because you are not signed in.</strong>{" "}
      Click here to sign in.
    </p>
  </Link>
);
