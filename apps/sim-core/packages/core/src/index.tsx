import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./components/App";
import { HashRouter } from "./components/HashRouter/HashRouter";
import { IS_LOCAL, IS_STAGING } from "./util/api";
import { LocalStorageKey } from "./hooks/useLocalStorage";
import { boot } from "./boot";
import {
  getBuildStampFromUrl,
  getUrlForCurrentRouteWithBuildStamp,
} from "./routes";

import "./styles.css";

if (IS_STAGING) {
  const hashVersion = getBuildStampFromUrl();
  const storedVersion = localStorage.getItem(LocalStorageKey.CachedVersion);

  if (hashVersion === BUILD_STAMP) {
    localStorage.setItem(LocalStorageKey.CachedVersion, BUILD_STAMP);
  } else if (storedVersion && !(hashVersion && storedVersion === BUILD_STAMP)) {
    window.location.href = getUrlForCurrentRouteWithBuildStamp(storedVersion);
  }
}

console.log("HASH Core Version:", BUILD_STAMP);

boot(true).then(() => {
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <App>
      <HashRouter />
    </App>,
  );
});
