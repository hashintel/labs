import React, { FC, lazy, Suspense } from "react";

import { IconLoadingProps } from "./types";

const lazyIconPromise = import(
  /* webpackChunkName: "IconLoading", webpackPrefetch: true */ "./IconLoading"
);

const LazyIconLoadingInner = lazy(async () => ({
  default: (await lazyIconPromise).IconLoading,
}));

export const LazyIconLoading: FC<IconLoadingProps> = (props) => (
  <Suspense fallback={null}>
    <LazyIconLoadingInner {...props} />
  </Suspense>
);
