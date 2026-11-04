import React, { FC, memo, useEffect } from "react";

import { HashCore } from "../HashCore";
import { LoadingIcon } from "../LoadingIcon";
import { runBootstrap } from "../../features/bootstrap";
import { useHandlePromiseRejection } from "../ErrorBoundary";
import { useRouteEffect } from "./Effect";
import { useUser } from "../../features/user/UserContext";
import { useExamples } from "../../features/examples/ExamplesContext";
import { useToast } from "../../features/toast/ToastContext";
import { useProject } from "../../features/project/ProjectContext";

export const HashRouter: FC = memo(function HashApp() {
  const { bootstrapped, bootstrapUser } = useUser();
  const { setExamples } = useExamples();
  const { setToastForProject } = useToast();
  const { currentProject } = useProject();
  const handlePromiseRejection = useHandlePromiseRejection();
  const routeEffect = useRouteEffect();

  useEffect(() => {
    handlePromiseRejection(
      runBootstrap({
        bootstrapUser,
        setExamples,
        setToastForProject,
        currentProject,
      }),
    );
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlePromiseRejection]);

  if (!(bootstrapped && routeEffect)) {
    return <LoadingIcon fullScreen={true} />;
  }

  return (
    <>
      <HashCore />
      {routeEffect}
    </>
  );
});
