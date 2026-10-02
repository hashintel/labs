import { createContext, use } from "react";

import type { CompilerOptions } from "../../compiler";

/**
 * What a page or a card can ask the app to open: a question in the Semantics
 * view, or an example in the Playground view, under the options given in place
 * of the ones it opens with. The app provides it; outside the app nothing
 * happens.
 */
export type Navigation = {
  openQuestion: (id: string) => void;
  openExample: (id: string, options?: CompilerOptions) => void;
};

const NO_NAVIGATION: Navigation = {
  openQuestion: () => {},
  openExample: () => {},
};

export const NavigationContext = createContext<Navigation>(NO_NAVIGATION);

export function useNavigation(): Navigation {
  return use(NavigationContext);
}
