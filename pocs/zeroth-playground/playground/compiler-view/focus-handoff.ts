import type { StageId } from "./stages";

/**
 * The ids the stage overview and the stage card pass the keyboard focus
 * between. A click on an overview row pins its stage, and the card that
 * replaces the overview takes the focus on its "All stages" link. That link
 * unpins, and the overview that comes back puts the focus on the stage's row.
 */
export type FocusHandoff = {
  back: string;
  row: (stage: StageId) => string;
};

/** The handoff's ids under one prefix, unique to the view that renders both. */
export function focusHandoff(prefix: string): FocusHandoff {
  return { back: `${prefix}back`, row: (stage) => `${prefix}row-${stage}` };
}

/** Moves the keyboard focus to the element with the id, once React has rendered it. */
export function focusById(id: string): void {
  document.getElementById(id)?.focus();
}
