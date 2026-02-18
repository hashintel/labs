import React, { FC, memo, useEffect } from "react";
import { useDispatch } from "react-redux";

import type { AppDispatch } from "../../features/types";
import { HashCore } from "../HashCore";
import { LoadingIcon } from "../LoadingIcon";
import { bootstrapApp } from "../../features/thunks";
import { useHandlePromiseRejection } from "../ErrorBoundary";
import { useRouteEffect } from "./Effect";
import { useUser } from "../../features/user/UserContext";

export const HashRouter: FC = memo(function HashApp() {
  const dispatch = useDispatch<AppDispatch>();
  const { bootstrapped } = useUser();
  const handlePromiseRejection = useHandlePromiseRejection();
  const routeEffect = useRouteEffect();

  useEffect(() => {
    handlePromiseRejection(dispatch(bootstrapApp()) as any);
  }, [handlePromiseRejection, dispatch]);

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

// // @ts-ignore
// HashApp.whyDidYouRender = {
//   customName: "HashApp"
// };
