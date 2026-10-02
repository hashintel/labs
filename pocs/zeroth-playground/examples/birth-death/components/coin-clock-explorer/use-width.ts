import { useState } from "react";

/**
 * The width of an element in CSS pixels, kept up to date by a ResizeObserver,
 * so that a plot can draw at one pixel per unit and keep its text at a fixed
 * size. It is 0 until the element is laid out.
 */
export function useWidth(): readonly [number, React.RefCallback<HTMLElement>] {
  const [width, setWidth] = useState(0);
  function observe(element: HTMLElement | null) {
    if (element === null) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }
  return [width, observe];
}
