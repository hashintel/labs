import React, {
  memo,
  forwardRef,
  ForwardRefExoticComponent,
  RefAttributes,
  CSSProperties,
} from "react";

import "./MonacoContainer.css";

interface MonacoContainerProps {
  hidden: boolean;
}

const hiddenStyle: CSSProperties = {
  display: "none",
};

export const MonacoContainer: ForwardRefExoticComponent<
  MonacoContainerProps & RefAttributes<HTMLDivElement>
> = memo(
  forwardRef<HTMLDivElement, MonacoContainerProps>(({ hidden }, ref) => (
    <div
      className="MonacoContainer"
      style={hidden ? hiddenStyle : undefined}
      ref={ref}
    />
  )),
);

// // @ts-expect-error
// MonacoContainer.whyDidYouRender = {
//   customName: "MonacoContainer"
// };
