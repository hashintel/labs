import { useCallback } from "react";

/**
 * typescript thinks writeText is always defined and thinks this ternary is
 * unnecessary, but it's not because writeText is a relatively new API
 */
// @ts-ignore
const clipboardPromise = navigator.clipboard?.writeText
  ? Promise.resolve(navigator.clipboard)
  : import(
      /* webpackChunkName: "clipboard-polyfill" */ "clipboard-polyfill"
    ).then(({ writeText }) => ({ writeText }));

export const useClipboardWriteText = () =>
  useCallback(
    (text: string) =>
      clipboardPromise.then((clipboard) => clipboard.writeText(text)),
    [],
  );
