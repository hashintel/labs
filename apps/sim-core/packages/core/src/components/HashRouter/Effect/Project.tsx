import React, { FC, useEffect, useMemo } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { HookRouter, setQueryParams, useRoutes } from "hookrouter";

import type { AppDispatch } from "../../../features/types";
import { HashRouterEffectFork } from "./Fork";
import { HashRouterEffectNotFound } from "./NotFound";
import { LinkableProject } from "../../../features/project/types";
import { ProjectAccessScope } from "../../../shared/scopes";
import { fetchProject } from "../../../features/project/slice";
import { getSafeQueryParams } from "../../../util/getSafeQueryParams";
import { parseAccessCodeInParams } from "../../../util/parseAccessCodeInParams";
import { selectBootstrapped } from "../../../features/user/selectors";
import { selectCurrentProjectUrl } from "../../../features/project/selectors";
import { urlFromProject } from "../../../routes";
import { useHandlePromiseRejection } from "../../ErrorBoundary";
import { withSignal } from "../../../util/withSignal";

interface ProjectParams {
  namespace: string;
  path: string;
  ref: string;
  fork?: boolean;
}

const routeHandler = ({
  namespace,
  path,
  ref = "main",
}: HookRouter.QueryParams): ProjectParams => ({
  namespace: `@${namespace}`,
  path,
  ref,
});

const HashRouterEffectProjectFetch: FC<{
  project: LinkableProject;
}> = ({ project }) => {
  const dispatch = useDispatch<AppDispatch>();
  const handlePromiseRejection = useHandlePromiseRejection();
  const bootstrapped = useSelector(selectBootstrapped);
  const store = useStore();

  useEffect(() => {
    const projectUrl = urlFromProject(project);

    if (
      !bootstrapped ||
      selectCurrentProjectUrl(store.getState()) === projectUrl
    ) {
      return;
    }

    const { fromLegacy, file, ...params } = getSafeQueryParams();
    const { access, ...otherParams } = parseAccessCodeInParams(
      params,
      ProjectAccessScope.Read,
    );

    setQueryParams(
      {
        ...otherParams,
        fromLegacy: undefined,
        file: undefined,
        accessCode: access?.code ?? undefined,
      },
      true,
    );

    // Assigning here due to a bug in TS typing
    const controller = new AbortController();

    async function fetch() {
      await withSignal(
        //@ts-expect-error redux problems
        dispatch(
          //@ts-expect-error redux problems
          fetchProject({
            project,
            fromLegacy: !!fromLegacy,
            file,
            access,
          }),
        ),
        controller.signal,
      );
    }

    handlePromiseRejection(fetch());

    return () => {
      controller.abort();
    };
  }, [dispatch, bootstrapped, handlePromiseRejection, project, store]);

  return null;
};

export const HashRouterEffectProject: FC = () => {
  const routeResult: ProjectParams | null = useRoutes({
    ":namespace/:path": routeHandler,
    ":namespace/:path/:ref": routeHandler,
    ":namespace/:path/:ref/fork": (args) => ({
      ...routeHandler(args),
      fork: true,
    }),
  });

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
