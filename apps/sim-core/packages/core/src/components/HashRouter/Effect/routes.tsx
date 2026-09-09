import React from "react";

import { HashRouterEffectDefaultProject } from "./DefaultProject";
import { HashRouterEffectLegacySimulation } from "./LegacySimulation";
import { HashRouterEffectNewProject } from "./NewProject";
import { HashRouterEffectNotFound } from "./NotFound";
import { HashRouterEffectOnboard } from "./Onboard";
import { HashRouterEffectProject } from "./Project";
import { HashRouterEffectRedirectToRoot } from "./RedirectToRoot";
import { RouteMap, usePathRouter } from "../../../util/usePathRouter";
import { getRouteFromQuery } from "../../../routes";
import { navigate } from "../../../util/navigation";

const routes: RouteMap = {
  "/": () => <HashRouterEffectDefaultProject />,

  "/new": () => <HashRouterEffectNewProject />,
  "/new/:template": ({ template }: { template: string }) => (
    <HashRouterEffectNewProject template={template} />
  ),

  "/onboard": () => <HashRouterEffectOnboard />,
  "/onboard/:step": ({ step }: { step: string }) => (
    <HashRouterEffectOnboard step={step} />
  ),

  "/simulation/:id": ({ id }: { id: string }) => (
    <HashRouterEffectLegacySimulation id={id} />
  ),
  "/simulation/:id/:name": ({ id }: { id: string }) => (
    <HashRouterEffectLegacySimulation id={id} />
  ),

  "/signup": () => <HashRouterEffectRedirectToRoot />,
  "/signin": () => <HashRouterEffectRedirectToRoot />,

  "/@*": () => <HashRouterEffectProject />,

  "/:buildstamp/index.html": () => {
    setImmediate(() => {
      const { path, query } = getRouteFromQuery();
      navigate(path, true, query, true);
    });
  },

  "*": () => <HashRouterEffectNotFound />,
};

export const useRouteEffect = () => usePathRouter(routes);
