import React from "react";
import { HookRouter, navigate, useRoutes } from "hookrouter";

import { HashRouterEffectDefaultProject } from "./DefaultProject";
import { HashRouterEffectLegacySimulation } from "./LegacySimulation";
import { HashRouterEffectNewProject } from "./NewProject";
import { HashRouterEffectNotFound } from "./NotFound";
import { HashRouterEffectOnboard } from "./Onboard";
import { HashRouterEffectProject } from "./Project";
import { HashRouterEffectSignin } from "./Signin";
import { HashRouterEffectSignup } from "./Signup";
import { getRouteFromQuery } from "../../../routes";

const routes: HookRouter.RouteObject = {
  "/": () => <HashRouterEffectDefaultProject />,

  "/new": () => <HashRouterEffectNewProject />,
  "/new/:template": ({ template }) => (
    <HashRouterEffectNewProject template={template} />
  ),

  "/onboard": () => <HashRouterEffectOnboard />,
  "/onboard/:step": ({ step }) => <HashRouterEffectOnboard step={step} />,

  "/simulation/:id": ({ id }) => <HashRouterEffectLegacySimulation id={id} />,
  "/simulation/:id/:name": ({ id }) => (
    <HashRouterEffectLegacySimulation id={id} />
  ),

  "/signup": () => <HashRouterEffectSignup />,
  "/signin": () => <HashRouterEffectSignin />,

  "/@*": () => <HashRouterEffectProject />,

  /**
   * @todo route handlers should be side effect free – handle this elsewhere
   */
  "/:buildstamp/index.html": () => {
    setTimeout(() => {
      /**
       * hookrouter's navigate has a bug where it incorrectly strips queries
       * included in the path, so we have to separate them.
       *
       * @see https://github.com/Paratron/hookrouter/issues/70
       * @todo consider moving to https://github.com/kyeotic/raviger
       */
      const { path, query } = getRouteFromQuery();

      navigate(path, true, query, true);
    });
  },

  "*": () => <HashRouterEffectNotFound />,
};

export const useRouteEffect = () => useRoutes(routes);
