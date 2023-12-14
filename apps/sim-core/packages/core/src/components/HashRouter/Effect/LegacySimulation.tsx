import { FC, useEffect } from "react";
import { useDispatch } from "react-redux";
import { navigate } from "hookrouter";

import { HashCoreAccessGateKind } from "../../HashCore/AccessGate";
import { linkableProjectByLegacyId } from "../../../util/api/queries";
import { setAccessGate } from "../../../features/project/slice";
import { urlFromProject } from "../../../routes";
import { useHandlePromiseRejection } from "../../ErrorBoundary";

export const HashRouterEffectLegacySimulation: FC<{ id: string }> = ({
  id,
}) => {
  const dispatch = useDispatch();
  const handlePromiseRejection = useHandlePromiseRejection();

  useEffect(() => {
    const controller = new AbortController();

    async function fetchLegacyProject() {
      try {
        const simulation = await linkableProjectByLegacyId(
          id,
          controller.signal,
        );

        navigate(urlFromProject(simulation), true, { fromLegacy: true }, false);
      } catch (err) {
        dispatch(
          setAccessGate({
            accessGate: {
              kind: HashCoreAccessGateKind.NotFound,
              props: { requestedProject: null },
            },
            url: window.location.pathname,
          }),
        );
      }
    }

    handlePromiseRejection(fetchLegacyProject());

    return () => {
      controller.abort();
    };
  }, [dispatch, handlePromiseRejection, id]);

  return null;
};
