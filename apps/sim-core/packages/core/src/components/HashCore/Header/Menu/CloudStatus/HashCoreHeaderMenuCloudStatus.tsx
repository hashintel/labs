import React, { FC } from "react";
import classNames from "classnames";

import { Scope, useScopes } from "../../../../../features/scopes";
import { SimpleTooltip } from "../../../../SimpleTooltip";
// import { forceLogIn } from "../../../../../features/user/utils";
import { selectProviderTarget } from "../../../../../features/simulator/simulate/selectors";
// import { toggleProviderTarget } from "../../../../../features/simulator/simulate/thunks";
import { useSimulatorSelector } from "../../../../../features/simulator/context";

import "./HashCoreHeaderMenuCloudStatus.css";

export const HashCoreHeaderMenuCloudStatus: FC<{ className?: string }> = ({
  className,
}) => {
  const target = useSimulatorSelector(selectProviderTarget);
  // const dispatch = useSimulatorDispatch();
  const { canUseCloud, canLogin } = useScopes(Scope.useCloud, Scope.login);
  const reallyDisabled = !canUseCloud && !canLogin;

  return (
    <button
      disabled={reallyDisabled}
      onClick={(evt) => {
        evt.preventDefault();
        // if (canUseCloud) {
        //   dispatch(toggleProviderTarget());
        // } else if (canLogin) {
        //   forceLogIn();
        // }
        window.open("https://hash.ai/contact");
      }}
      className={classNames(`HashCoreHeaderMenuCloudStatus`, className)}
    >
      <span className="HashCoreHeaderMenuCloudStatus__Label">
        Cloud {target === "cloud" ? <>Active</> : <>Inactive</>}
      </span>
      <div
        className={`HashCoreHeaderMenuCloudStatus__Indicator HashCoreHeaderMenuCloudStatus__Indicator--running-${target}`}
      />
      {/*{target === "cloud" ? (*/}
      {/*  <SimpleTooltip position="below">*/}
      {/*    <h4>Experiments will run in hCloud</h4>*/}
      {/*    <p>Single-runs will continue to execute in-browser</p>*/}
      {/*  </SimpleTooltip>*/}
      {/*) : canLogin ? (*/}
      {/*  <SimpleTooltip position="below">*/}
      {/*    <h4>Create an account or sign in</h4>*/}
      {/*    <p>Click here to sign in now</p>*/}
      {/*  </SimpleTooltip>*/}
      {/*) : (*/}
      <SimpleTooltip position="below">
        <h4>Contact us to use hCloud</h4>
        <p>
          If you want to run simulations in the cloud, please click this button
          and contact us to discuss your needs
        </p>
      </SimpleTooltip>
      {/*)}*/}
    </button>
  );
};
