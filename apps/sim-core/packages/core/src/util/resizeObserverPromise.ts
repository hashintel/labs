export let resizeObserverPromise = Promise.resolve(window.ResizeObserver);

if (!window.ResizeObserver) {
  //@ts-expect-error Todo: Clean out this polyfill.
  resizeObserverPromise = import(
    /* webpackChunkName: "ResizeObserver-polyfill" */ "@juggle/resize-observer/lib/exports/resize-observer"
  )
    .then((module) => {
      //@ts-expect-error Todo: Clean out this polyfill.
      window.ResizeObserver = module.ResizeObserver;

      return module.ResizeObserver;
    })
    .catch((error) => {
      console.error("Could not fetch polyfill for resize observer", error);

      throw error;
    });
}
