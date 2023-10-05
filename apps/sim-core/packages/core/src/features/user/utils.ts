import { navigate } from "hookrouter";

import { getCurrentRoute } from "../../routes";

export const forceLogIn = (replace: boolean = false) => {
  navigate("/signin", replace, { route: getCurrentRoute() }, true);
};
