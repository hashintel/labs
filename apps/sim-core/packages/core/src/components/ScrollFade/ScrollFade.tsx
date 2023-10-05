import React, { FC, ReactNode } from "react";

import { ScrollFadeShadow } from "./ScrollFadeShadow";
import { useScrollState } from "../../hooks/useScrollState";

import "./ScrollFade.css";

/**
 * @deprecated
 *
 * @use useScrollFade
 * @use ScrollFadeShadow
 */
export const ScrollFade: FC<{
  children: (setRef: (ref: HTMLElement) => void) => ReactNode;
}> = ({ children }) => {
  const [setRef, visible] = useScrollState();

  return (
    <div className="ScrollFade">
      {children(setRef)}
      <ScrollFadeShadow visible={visible} />
    </div>
  );
};
