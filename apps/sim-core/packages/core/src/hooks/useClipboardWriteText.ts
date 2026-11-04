import { useCallback } from "react";

/**
 * navigator.clipboard?.writeText may not exist in older browsers despite
 * TypeScript's lib.dom.d.ts declaring it as always present.
 */
// @ts-expect-error -- writeText may be undefined at runtime in older browsers
const clipboardPromise = navigator.clipboard?.writeText
  ? Promise.resolve(navigator.clipboard)
  : import("clipboard-polyfill").then(({ writeText }) => ({ writeText }));

export const useClipboardWriteText = () =>
  useCallback(
    (text: string) =>
      clipboardPromise.then((clipboard) => clipboard.writeText(text)),
    [],
  );
