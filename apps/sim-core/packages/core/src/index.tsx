import React from "react";
import { render } from "react-dom";

import { App } from "./components/App";
import { HashRouter } from "./components/HashRouter/HashRouter";
import { IS_LOCAL, IS_STAGING } from "./util/api";
import { LocalStorageKey } from "./hooks/useLocalStorage";
import { boot } from "./boot";
import {
  getBuildStampFromUrl,
  getUrlForCurrentRouteWithBuildStamp,
} from "./routes";
import { store } from "./features/store";

import "./styles.css";

if (IS_LOCAL) {
  const whyDidYouRender = require("@welldone-software/why-did-you-render");
  whyDidYouRender(React, {
    collapseGroups: true,
  });
}

if (IS_STAGING) {
  const hashVersion = getBuildStampFromUrl();
  const storedVersion = localStorage.getItem(LocalStorageKey.CachedVersion);

  if (hashVersion === WEBPACK_BUILD_STAMP) {
    localStorage.setItem(LocalStorageKey.CachedVersion, WEBPACK_BUILD_STAMP);
  } else if (
    storedVersion &&
    !(hashVersion && storedVersion === WEBPACK_BUILD_STAMP)
  ) {
    window.location.href = getUrlForCurrentRouteWithBuildStamp(storedVersion);
  }
}

// Report our version number on startup:
console.log("HASH Core Version:", WEBPACK_BUILD_STAMP);

boot(true).then(() => {
  render(
    <App store={store}>
      <HashRouter />
    </App>,
    document.getElementById("root")
  );
});
