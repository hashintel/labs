import React, { FC, useEffect } from "react";
import { useModal } from "react-modal-hook";

import { ModalSignup } from "../../Modal/Signup/ModalSignup";
import { Scope, useScope } from "../../../features/scopes";
import { useLoggedInNavigateAway } from "./hooks";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";

export const HashRouterEffectSignup: FC = () => {
  const [{ route }] = useSafeQueryParams();
  const navigateAway = useLoggedInNavigateAway(route);
  const canLogin = useScope(Scope.login);

  const [showModal, hideModal] = useModal(
    () => <ModalSignup onClose={() => navigateAway(false)} route={route} />,
    [navigateAway, route]
  );

  useEffect(() => {
    if (canLogin) {
      showModal();

      return () => {
        hideModal();
      };
    } else {
      navigateAway(true);
    }
  }, [canLogin, hideModal, navigateAway, showModal]);

  return null;
};
