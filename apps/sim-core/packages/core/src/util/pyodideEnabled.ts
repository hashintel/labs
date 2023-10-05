import { isSafari, safariVersion } from "./isSafari";

export const pyodideEnabled = () => {
  if (isSafari()) {
    const version = safariVersion();
    if (version && version.major > 13) {
      return true;
    }
    return false;
  }
  return true;
};
