import React, { FC, useEffect } from "react";
import { useModal } from "react-modal-hook";

import { ModalSignin } from "../../Modal/Signin/ModalSignin";
import { Scope, useScope } from "../../../features/scopes";
import { useLoggedInNavigateAway } from "./hooks";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";

export const HashRouterEffectSignin: FC = () => {
  const [{ route }] = useSafeQueryParams();
  const navigateAway = useLoggedInNavigateAway(route);
  const canLogin = useScope(Scope.login);

  const [showModal, hideModal] = useModal(
    () => <ModalSignin onClose={() => navigateAway(false)} route={route} />,
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
  }, [hideModal, canLogin, navigateAway, showModal]);

  return null;
};
