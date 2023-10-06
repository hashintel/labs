import React, {
  FC,
  HTMLProps,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import classNames from "classnames";

import "./ShrinkWrap.css";

const LINE_COUNT_CLASSNAME = "ShrinkWrap--lineCount";

export const ShrinkWrap: FC<
  Omit<HTMLProps<HTMLDivElement>, "style"> & { lineCount?: number }
> = ({ children, lineCount, className = "", ...props }) => {
  const divRef = useRef<HTMLDivElement | null>(null);

  const resize = useCallback((lineCount?: number) => {
    const node = divRef.current;
    const span = node?.firstElementChild as HTMLSpanElement;

    if (node && span) {
      if (lineCount) {
        span.style.display = "block";
        node.classList.remove(LINE_COUNT_CLASSNAME);
        span.style.removeProperty("max-width");
        const lineHeight = Math.floor(
          parseFloat(
            window.getComputedStyle(span).lineHeight.replace("normal", "16px")
          )
        );

        while (Math.ceil(span.offsetHeight / lineHeight) < lineCount + 1) {
          const widthBefore = span.getBoundingClientRect().width;
          span.style.maxWidth = `${widthBefore - 1}px`;

          if (span.getBoundingClientRect().width === widthBefore) {
            break;
          }
        }

        span.style.maxWidth = `${span.getBoundingClientRect().width + 1}px`;
        node.classList.add(LINE_COUNT_CLASSNAME);
      } else {
        span.style.display = "inline";
        node.style.width = "auto";
        node.style.width = `${span.getBoundingClientRect().width}px`;
      }
    }
  }, []);

  useLayoutEffect(() => {
    const handler = () => resize(lineCount);

    window.addEventListener("resize", handler);
    handler();

    return () => {
      window.removeEventListener("resize", handler);
    };
  }, [resize, lineCount]);

  return (
    <div
      {...props}
      ref={divRef}
      style={{
        boxSizing: "content-box",
        width: "auto",
        WebkitLineClamp: lineCount,
        lineClamp: lineCount,
      }}
      className={classNames(className, {
        [LINE_COUNT_CLASSNAME]: typeof lineCount === "number",
      })}
    >
      <span>{children}</span>
    </div>
  );
};
