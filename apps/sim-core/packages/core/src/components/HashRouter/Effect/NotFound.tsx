import { FC, useEffect } from "react";
import { useDispatch } from "react-redux";

import { HashCoreAccessGateKind } from "../../HashCore/AccessGate";
import { setAccessGate } from "../../../features/project/slice";

export const HashRouterEffectNotFound: FC = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(
      setAccessGate({
        accessGate: {
          kind: HashCoreAccessGateKind.NotFound,
          props: { requestedProject: null },
        },
        url: window.location.pathname,
      }),
    );
  }, [dispatch]);

  return null;
};
