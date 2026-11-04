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

import React, { FC, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import { App } from "../App";
import { BasicUser } from "../../util/api/types";
import { EmbedApp } from "./EmbedApp";
import { RemoteSimulationProject } from "../../features/project/types";
import { ValidatedEmbedParams } from "../../util/getEmbedParams";
import { boot } from "../../boot";
import { getUiQueryParams } from "../../hooks/useParameterisedUi";
import { useProject } from "../../features/project/ProjectContext";
import { useUser } from "../../features/user/UserContext";
import { useViewer } from "../../features/viewer/ViewerContext";

interface EmbedBootstrapProps {
  params: ValidatedEmbedParams;
  basicUserPromise: Promise<BasicUser | null | undefined>;
}

/**
 * Inner component that initializes embed state via context hooks on mount.
 * This replaces the old pattern of dispatching Redux actions before render.
 */
const EmbedBootstrap: FC<EmbedBootstrapProps> = ({
  params,
  basicUserPromise,
}) => {
  const { activateEmbedded } = useViewer();
  const { fetchProject } = useProject();
  const { setBasicUser } = useUser();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const { tabs, view } = getUiQueryParams();
    activateEmbedded({ tabs, tab: view });

    fetchProject({
      project: { pathWithNamespace: params.project, ref: params.ref },
      redirect: false,
    });

    basicUserPromise.then((basicUser) => {
      if (basicUser) {
        setBasicUser(basicUser);
      }
    });
  }, [activateEmbedded, fetchProject, setBasicUser, params, basicUserPromise]);

  return <EmbedApp />;
};

// @todo error handling
export const bootEmbed = async (
  params: ValidatedEmbedParams,
  _prefetchedProjectPromise: Promise<RemoteSimulationProject>,
  basicUserPromise: Promise<BasicUser | null | undefined>,
) => {
  await boot(false);

  const root = createRoot(document.getElementById("root")!);
  root.render(
    <App>
      <EmbedBootstrap params={params} basicUserPromise={basicUserPromise} />
    </App>,
  );
};
