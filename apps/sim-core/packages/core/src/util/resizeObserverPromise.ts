export let resizeObserverPromise = Promise.resolve(window.ResizeObserver!);

if (!window.ResizeObserver) {
  resizeObserverPromise = import(
    /* webpackChunkName: "ResizeObserver-polyfill" */ "@juggle/resize-observer/lib/exports/resize-observer"
  )
    .then((module) => {
      window.ResizeObserver = module.ResizeObserver;

      return module.ResizeObserver;
    })
    .catch((error) => {
      console.error("Could not fetch polyfill for resize observer", error);

      throw error;
    });
}
