import { useRef, useState } from "react";

import type { PanelFold } from "./panel";

/** What a collapsible grid track or group panel of react-resizable-panels lets a toggle do. */
export type Foldable = {
  isCollapsed: () => boolean;
  collapse: () => void;
  expand: () => void;
};

/** How long a fold eases; the stylesheet's `--fold-duration` says the same. */
const FOLD_MS = 260;

/**
 * The folds of a set of collapsible tracks or panels, as React state. The
 * library owns the sizes; `sync`, called on every layout change, mirrors which
 * ones are collapsed, a drag past a threshold included. A toggle folds or
 * unfolds one and raises `easing` while the fold animates, so the container
 * transitions its layout then, and never under a drag.
 */
export function useFolds<Key extends string>(
  keys: readonly Key[],
  handleOf: (key: Key) => Foldable | null | undefined,
) {
  const [collapsed, setCollapsed] = useState<readonly Key[]>([]);
  const [easing, setEasing] = useState(false);
  const easingTimer = useRef<number | undefined>(undefined);

  function sync() {
    const next = keys.filter((key) => handleOf(key)?.isCollapsed() ?? false);
    setCollapsed((current) =>
      current.length === next.length && current.every((key, index) => key === next[index])
        ? current
        : next,
    );
  }

  function toggle(key: Key) {
    const handle = handleOf(key);
    if (handle === null || handle === undefined) {
      return;
    }
    setEasing(true);
    // A toggle during an earlier fold eases for its own full duration.
    window.clearTimeout(easingTimer.current);
    easingTimer.current = window.setTimeout(() => setEasing(false), FOLD_MS);
    if (handle.isCollapsed()) {
      handle.expand();
    } else {
      handle.collapse();
    }
  }

  /** The fold a `Panel` takes for one key, folding against `edge`. */
  function foldOf(key: Key, edge: PanelFold["edge"]): PanelFold {
    return { edge, collapsed: collapsed.includes(key), onToggle: () => toggle(key) };
  }

  return { foldOf, sync, easing };
}
