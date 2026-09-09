import { FC, useEffect } from "react";
import { navigate } from "../../../util/navigation";

import { HashCoreAccessGateKind } from "../../HashCore/AccessGate";
import { linkableProjectByLegacyId } from "../../../util/api/queries";
import { urlFromProject } from "../../../routes";
import { useHandlePromiseRejection } from "../../ErrorBoundary";
import { useProject } from "../../../features/project/ProjectContext";

export const HashRouterEffectLegacySimulation: FC<{ id: string }> = ({
  id,
}) => {
  const { setAccessGate } = useProject();
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
      } catch {
        setAccessGate({
          accessGate: {
            kind: HashCoreAccessGateKind.NotFound,
            props: { requestedProject: null },
          },
          url: window.location.pathname,
        });
      }
    }

    handlePromiseRejection(fetchLegacyProject());

    return () => {
      controller.abort();
    };
  }, [setAccessGate, handlePromiseRejection, id]);

  return null;
};
