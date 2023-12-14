import React, { FC } from "react";
import { Provider, useSelector, useStore } from "react-redux";
import { Store } from "@reduxjs/toolkit";
import classNames from "classnames";

import { IconDiscord } from "../Icon";
import { Link } from "../Link/Link";
import { RootState } from "../../features/types";
import { Scope, selectScope } from "../../features/scopes";
import { store as appStore } from "../../features/store";
import { selectActivityVisible } from "../../features/viewer/selectors";

import "./DiscordWidget.css";

export const DISCORD_URL = "https://discord.gg/BPMrGAhjPh";

/**
 * @warning This component specifically does not rely on a Redux store being in
 *          context, as it can be rendered by ErrorBoundary outside of the Redux
 *          store provider. Do not use any features that rely on context – and
 *          this component must make every attempt to avoid/catch errors.
 */
export const BasicDiscordWidget: FC<{
  className?: string;
  store?: Store<RootState>;
  errored?: boolean;
}> = ({ className, store = appStore, errored = false }) => {
  let loggedIn = true;

  try {
    loggedIn = selectScope[Scope.useAccount](store.getState());
  } catch {
    // Store may not be present, so hide that error.
  }

  const children = <IconDiscord />;
  const props = { className: classNames("DiscordWidget", className) };

  if (!loggedIn) {
    const url = "/signup";

    if (errored) {
      return (
        <a {...props} href={url}>
          {children}
        </a>
      );
    } else {
      return (
        <Provider store={store}>
          <Link {...props} path={url}>
            {children}
          </Link>
        </Provider>
      );
    }
  }

  return (
    <a {...props} href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
};

export const DiscordWidget: FC = () => {
  const activityVisible = useSelector(selectActivityVisible);
  const store = useStore();

  return (
    <BasicDiscordWidget
      className={classNames({
        "DiscordWidget--higher": !activityVisible,
      })}
      store={store}
    />
  );
};
