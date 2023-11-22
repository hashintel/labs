import type { ReleaseMeta } from "../types";

export const getReleaseMeta = (() => {
  const lastRequest: Promise<ReleaseMeta> | null = null;

  return (): Promise<ReleaseMeta> => {
    if (lastRequest) {
      return lastRequest;
    }
    // Migration shim

    return Promise.resolve({
      keywords: [],
      licenses: [],
      subjects: undefined,
    });

    // const currentRequest = query<ReleaseMeta>(
    //   `
    //     query getReleaseMeta {
    //       keywords { name, count }
    //       licenses {
    //         id
    //         name
    //         description
    //         url
    //         default
    //       }
    //       subjects {
    //         id
    //         name
    //         parentChain
    //       }
    //     }
    //   `,
    // );

    // lastRequest = currentRequest;

    // return currentRequest.catch((err) => {
    //   if (err.name !== "AbortError") {
    //     console.error("Unable to get release meta", err);
    //     lastRequest = null;
    //   }

    //   throw err;
    // });
  };
})();
