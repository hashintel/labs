import React, { FC, Suspense, useEffect, useState } from "react";

import { LoadingIcon } from "../../LoadingIcon";

import "./SimulationViewerLazyTab.css";

export const SimulationViewerLazyTab: FC<{
  visible?: boolean;
  immediate?: boolean;
}> = ({ visible = false, immediate, children }) => {
  const [hasBeenVisible, setHasBeenVisible] = useState(visible);
  const [shouldShowFallback, setShouldShowFallback] = useState(false);

  useEffect(() => {
    const shouldShowFallbackTimeout = setTimeout(() => {
      setShouldShowFallback(true);
    }, 200);

    if (visible) {
      setHasBeenVisible(true);
    }

    return () => {
      clearTimeout(shouldShowFallbackTimeout);
    };
  }, [hasBeenVisible, visible]);

  const loading =
    shouldShowFallback || immediate ? (
      <div className="SimulationViewerLazyTab">
        <LoadingIcon />
      </div>
    ) : null;

  return visible || hasBeenVisible ? (
    <Suspense fallback={loading}>{children}</Suspense>
  ) : (
    loading
  );
};
