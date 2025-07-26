import React, { FC, useLayoutEffect, useRef } from "react";
import SplitterLayout, { SplitterLayoutProps } from "react-splitter-layout";
import classNames from "classnames";

import "./WrappedSplitterLayout.scss";

interface SplitterLayoutPrivateAPI {
  state: {
    secondaryPaneSize: number | undefined;
  };

  props: SplitterLayoutProps;

  setState: React.Component<
    SplitterLayoutProps,
    SplitterLayoutPrivateAPI["state"]
  >["setState"];

  container: HTMLElement;
}

/**
 * We use an iframe to display ProcessChart (and maybe other plugins later)
 * This messes with resizing panes when the mouse moves over the iframe.
 * @see https://github.com/zesik/react-splitter-layout/issues/7
 */
const setIframeInteractivity = (interactive = true) => {
  const iframes = document.getElementsByTagName("iframe");
  for (const iframe of iframes) {
    iframe.style.pointerEvents = interactive ? "all" : "none";
  }
};

/**
 * We have this to enable toggling the secondary pane without re-rendering
 * either of the primary or secondary panes. This is to work around a bug in
 * react-splitter-layout. We use CSS to show/hide it
 *
 * @see https://github.com/zesik/react-splitter-layout/issues/43
 *
 * Additionally, we sometimes set min-widths on the secondary pane via CSS
 * and there is a bug in react-splitter-layout where this is not taken into
 * account properly. This component works around that too.
 *
 * @see https://github.com/zesik/react-splitter-layout/issues/59
 * @see AnalysisViewer
 */
export const WrappedSplitterLayout: FC<
  SplitterLayoutProps & { primaryHidden?: boolean; secondaryHidden?: boolean }
> = ({
  primaryHidden = false,
  secondaryHidden = false,
  secondaryInitialSize,
  customClassName,
  onSecondaryPaneSizeChange,
  percentage,
  vertical,
  ...props
}) => {
  const ref = useRef<SplitterLayoutPrivateAPI | null>(null);
  const wasHiddenRef = useRef(secondaryHidden);

  /**
   * @todo support resetting size when toggling even when not using percentage
   */
  useLayoutEffect(() => {
    /**
     * @todo CiaranMn - removed 'percentage' from this check, why was it there?
     */
    if (ref.current && !secondaryHidden) {
      if (wasHiddenRef.current && ref.current.state.secondaryPaneSize === 0) {
        ref.current.setState({ secondaryPaneSize: secondaryInitialSize ?? 50 });
      }
    }

    wasHiddenRef.current = secondaryHidden;
  }, [percentage, secondaryHidden, secondaryInitialSize]);

  return (
    <SplitterLayout
      ref={ref as any}
      customClassName={classNames(customClassName, {
        "splitter-primary-hidden": primaryHidden,
        "splitter-secondary-hidden": secondaryHidden,
      })}
      percentage={percentage}
      vertical={vertical}
      secondaryInitialSize={secondaryInitialSize}
      onDragEnd={() => setIframeInteractivity(true)}
      onDragStart={() => setIframeInteractivity(false)}
      onSecondaryPaneSizeChange={(secondary) => {
        if (ref.current) {
          const container = ref.current.container;
          const secondaryPane = Array.from(container.children).find((node) =>
            node.matches(".layout-pane:not(.layout-pane-primary)"),
          )!;

          const totalBox = container.getBoundingClientRect();
          const secondaryBox = secondaryPane.getBoundingClientRect();

          const secondarySize = vertical
            ? secondaryBox.height
            : secondaryBox.width;
          const totalSize = vertical ? totalBox.height : totalBox.width;

          const secondaryPx = percentage
            ? (secondary / 100) * totalSize
            : secondary;

          if (Math.abs(secondarySize - secondaryPx) > 1) {
            const actualSecondary = percentage
              ? (secondarySize / totalSize) * 100
              : secondarySize;

            ref.current.setState({ secondaryPaneSize: actualSecondary });
            onSecondaryPaneSizeChange?.(actualSecondary);
          } else {
            onSecondaryPaneSizeChange?.(secondary);
          }
        } else {
          onSecondaryPaneSizeChange?.(secondary);
        }
      }}
      {...props}
    />
  );
};
