import { FC, useEffect } from "react";

import { HashCoreAccessGateKind } from "../../HashCore/AccessGate";
import { useProject } from "../../../features/project/ProjectContext";

export const HashRouterEffectNotFound: FC = () => {
  const { setAccessGate } = useProject();

  useEffect(() => {
    setAccessGate({
      accessGate: {
        kind: HashCoreAccessGateKind.NotFound,
        props: { requestedProject: null },
      },
      url: window.location.pathname,
    });
  }, [setAccessGate]);

  return null;
};
