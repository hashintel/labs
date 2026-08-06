import { FC, useEffect } from "react";
import { navigate } from "../../../util/navigation";

export const HashRouterEffectRedirectToRoot: FC = () => {
  useEffect(() => {
    navigate("/", true);
  }, []);
  return null;
};
