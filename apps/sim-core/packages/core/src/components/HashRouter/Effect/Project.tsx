import React, { FC, useEffect, useMemo } from "react";

import { RouteMap, usePathRouter } from "../../../util/usePathRouter";
import { setQueryParams } from "../../../util/navigation";

import { HashRouterEffectFork } from "./Fork";
import { HashRouterEffectNotFound } from "./NotFound";
import { LinkableProject } from "../../../features/project/types";
import { getSafeQueryParams } from "../../../util/getSafeQueryParams";
import { urlFromProject } from "../../../routes";
import { useHandlePromiseRejection } from "../../ErrorBoundary";
import { useProject } from "../../../features/project/ProjectContext";
import { useUser } from "../../../features/user/UserContext";

type ProjectParams = {
  namespace: string;
  path: string;
  ref: string;
  fork?: boolean;
};

const routeHandler = ({
  namespace,
  path,
  ref = "main",
}: Record<string, string>): ProjectParams => ({
  namespace: `@${namespace}`,
  path,
  ref,
});

const HashRouterEffectProjectFetch: FC<{
  project: LinkableProject;
}> = ({ project }) => {
  const handlePromiseRejection = useHandlePromiseRejection();
  const { bootstrapped } = useUser();
  const { currentProjectUrl, fetchProject } = useProject();

  useEffect(() => {
    const projectUrl = urlFromProject(project);

    if (!bootstrapped || currentProjectUrl === projectUrl) {
      return;
    }

    const { fromLegacy, file, accessCode: _ac, ...otherParams } =
      getSafeQueryParams();

    setQueryParams(
      {
        ...otherParams,
        fromLegacy: undefined,
        file: undefined,
        accessCode: undefined,
      },
      true,
    );

    const controller = new AbortController();

    async function doFetch() {
      await fetchProject({
        project,
        fromLegacy: !!fromLegacy,
        file,
      });
    }

    handlePromiseRejection(doFetch());

    return () => {
      controller.abort();
    };
  }, [bootstrapped, handlePromiseRejection, project, currentProjectUrl, fetchProject]);

  return null;
};

const projectRoutes: RouteMap = {
  "/@:namespace/:path": routeHandler,
  "/@:namespace/:path/:ref": routeHandler,
  "/@:namespace/:path/:ref/fork": (args: Record<string, string>) => ({
    ...routeHandler(args),
    fork: true,
  }),
};

export const HashRouterEffectProject: FC = () => {
  const routeResult: ProjectParams | null = usePathRouter(projectRoutes);

  const pathWithNamespace = routeResult
    ? `${routeResult.namespace}/${routeResult.path}`
    : null;

  const ref = routeResult?.ref;

  const project = useMemo<LinkableProject | null>(
    () => (pathWithNamespace && ref ? { pathWithNamespace, ref } : null),
    [pathWithNamespace, ref],
  );

  return project ? (
    routeResult?.fork ? (
      <HashRouterEffectFork project={project} />
    ) : (
      <HashRouterEffectProjectFetch project={project} />
    )
  ) : (
    <HashRouterEffectNotFound />
  );
};
