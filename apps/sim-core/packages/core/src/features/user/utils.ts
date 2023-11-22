import { navigate } from "hookrouter";

import { getCurrentRoute } from "../../routes";

export const forceLogIn = (replace = false) => {
  navigate("/signin", replace, { route: getCurrentRoute() }, true);
};
