/**
 * Needs to be here or webpack breaks due to circular dependencies…
 *
 * @todo figure out how to remove this
 */
import "../../util/api";
/**
 * This is lazily loaded by HashCoreViewer when its needed, but that's a shared
 * file so we can't boot the request early from there – this will do that for us
 */
import "../OpenInCore/OpenInCore";

import React from "react";
import { render } from "react-dom";

import { App } from "../App";
import { BasicUser } from "../../util/api/types";
import { EmbedApp } from "./EmbedApp";
import { RemoteSimulationProject } from "../../features/project/types";
import { ValidatedEmbedParams } from "../../util/getEmbedParams";
import { activateEmbedded } from "../../features/viewer/slice";
import { boot } from "../../boot";
import { fetchProject } from "../../features/project/slice";
import { getUiQueryParams } from "../../hooks/useParameterisedUi";
import { setBasicUser } from "../../features/user/slice";
import { store } from "../../features/store";

// @todo error handling
export const bootEmbed = async (
  params: ValidatedEmbedParams,
  prefetchedProjectPromise: Promise<RemoteSimulationProject>,
  basicUserPromise: Promise<BasicUser | null | undefined>
) => {
  await boot(false);

  const { tabs, view } = getUiQueryParams();

  store.dispatch(activateEmbedded({ tabs, tab: view }));

  await Promise.all([
    store.dispatch(
      fetchProject({
        project: { pathWithNamespace: params.project, ref: params.ref },
        prefetchedRemoteProject: prefetchedProjectPromise,
        redirect: false,
        access: params.access,
      })
    ),
    basicUserPromise.then((basicUser) => {
      if (basicUser) {
        return store.dispatch(setBasicUser(basicUser));
      }
    }),
  ]);

  render(
    <App store={store}>
      <EmbedApp />
    </App>,
    document.getElementById("root")
  );
};
