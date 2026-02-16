import React, { FC, useEffect } from "react";
import { navigate } from "hookrouter";

export const HashRouterEffectRedirectToRoot: FC = () => {
  useEffect(() => {
    navigate("/", true);
  }, []);
  return null;
};
