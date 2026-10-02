import { createContext, use } from "react";

import type { StageId } from "./stages";

/**
 * Which stage the compiler view is on, shared by the graph, the stage card
 * and the guide's stage references. The pointer sets the hovered stage and
 * the keyboard the focused one, apart, so a pointer passing by does not
 * clear a keyboard focus. A click or Enter pins a stage until it is clicked
 * again. The card and the graph follow `focused`: the hovered stage, else
 * the keyboard's, else the pinned one.
 */
export type StageFocus = {
  focused: StageId | null;
  pinned: StageId | null;
  /** The pointer enters a stage; `null` when it leaves. The focus follows once the pointer settles. */
  hover: (stage: StageId | null) => void;
  /** The keyboard focus enters a stage; `null` when it leaves. */
  focusKeyboard: (stage: StageId | null) => void;
  /** Pins the stage, or unpins it when it is the pinned one. */
  togglePin: (stage: StageId) => void;
};

/** Outside the compiler view nothing is focused and nothing reacts. */
const NO_FOCUS: StageFocus = {
  focused: null,
  pinned: null,
  hover: () => {},
  focusKeyboard: () => {},
  togglePin: () => {},
};

export const StageFocusContext = createContext<StageFocus>(NO_FOCUS);

export function useStageFocus(): StageFocus {
  return use(StageFocusContext);
}

/** The focus as a stage's target sees it, with the handlers that hover, keyboard-focus and pin that stage. */
export function useStageTarget(stage: StageId) {
  const { focused, pinned, hover, focusKeyboard, togglePin } = useStageFocus();
  return {
    focused,
    pinned,
    togglePin,
    handlers: {
      onMouseEnter: () => hover(stage),
      onMouseLeave: () => hover(null),
      onFocus: (event: React.FocusEvent<Element>) => {
        // A click focuses the target too; only a keyboard focus holds the stage.
        if (event.currentTarget.matches(":focus-visible")) {
          focusKeyboard(stage);
        }
      },
      onBlur: () => focusKeyboard(null),
      onClick: () => togglePin(stage),
    },
  };
}
