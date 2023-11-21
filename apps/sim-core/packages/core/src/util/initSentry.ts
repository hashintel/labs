import * as Sentry from "@sentry/browser";
import { CaptureConsole as CaptureConsoleIntegration } from "@sentry/integrations";
import { Options } from "@sentry/types";

import { IS_DEV, IS_LOCAL } from "./api";

export let sentryConsoleLogAbortController = new AbortController();

export const initSentry = (integrations?: Options["integrations"]) => {
  if (!IS_LOCAL) {
    // Enable error reporting:
    Sentry.init({
      dsn: "https://38b4aff591fa46f096b59d49d71c5d45@sentry.io/1509252",
      release: BUILD_STAMP,
      environment: IS_DEV ? "Development" : "Production",
      integrations: [
        new CaptureConsoleIntegration({
          levels: ["error"],
          ...(integrations ?? []),
        }),
      ],
      attachStacktrace: true,

      /**
       * We delay the logging of console errors to the end of the current tick
       * to ensure that ErrorBoundary has the opportunity to cancel it – this
       * helps prevent double logging
       */
      beforeSend(event) {
        if (event.logger === "console") {
          sentryConsoleLogAbortController = new AbortController();

          const { signal } = sentryConsoleLogAbortController;

          return new Promise((resolve) => {
            Promise.resolve().then(() => {
              resolve(signal.aborted ? null : event);
            });
          });
        }

        return event;
      },
    });

    // And put it in the console for us to access.
    // @ts-ignore
    window["Sentry"] = Sentry;
  }
};
