import React, { FC, useEffect, useMemo } from "react";
import { useDispatch, useStore } from "react-redux";

import { RouteMap, usePathRouter } from "../../../util/usePathRouter";
import { setQueryParams } from "../../../util/navigation";

import type { AppDispatch } from "../../../features/types";
import { HashRouterEffectFork } from "./Fork";
import { HashRouterEffectNotFound } from "./NotFound";
import { LinkableProject } from "../../../features/project/types";
import { fetchProject } from "../../../features/project/slice";
import { getSafeQueryParams } from "../../../util/getSafeQueryParams";
import { selectCurrentProjectUrl } from "../../../features/project/selectors";
import { urlFromProject } from "../../../routes";
import { useHandlePromiseRejection } from "../../ErrorBoundary";
import { useUser } from "../../../features/user/UserContext";
import { withSignal } from "../../../util/withSignal";

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
  const dispatch = useDispatch<AppDispatch>();
  const handlePromiseRejection = useHandlePromiseRejection();
  const { bootstrapped } = useUser();
  const store = useStore();

  useEffect(() => {
    const projectUrl = urlFromProject(project);

    if (
      !bootstrapped ||
      selectCurrentProjectUrl(store.getState()) === projectUrl
    ) {
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
      true
    );

    // Assigning here due to a bug in TS typing
    const controller = new AbortController();

    async function fetch() {
      await withSignal(
        dispatch(
          fetchProject({
            project,
            fromLegacy: !!fromLegacy,
            file,
          })
        ),
        controller.signal
      );
    }

    handlePromiseRejection(fetch());

    return () => {
      controller.abort();
    };
  }, [dispatch, bootstrapped, handlePromiseRejection, project, store]);

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
    [pathWithNamespace, ref]
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
