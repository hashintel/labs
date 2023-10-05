import React, {
  forwardRef,
  InputHTMLAttributes,
  useLayoutEffect,
  useRef,
} from "react";

import { useMeasurable } from "./hooks";

import "./ResizingInputText.css";

/**
 * Text rendering inside a paragraph and inside an input are not always the same
 * and so we need to add a couple of extra pixels to prevent text shifting when
 * the input is too small (which results in text jumping about as you resize)
 */
const INPUT_SIZE_SAFETY_BUFFER = 2;

type ResizingInputTextProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "style"
> & {
  onResize?: (newWidth: number) => void;
};

export const ResizingInputText = forwardRef<
  HTMLInputElement,
  ResizingInputTextProps
>(({ value, onChange, className, placeholder, onResize, ...props }, ref) => {
  const [measurableRef, width] = useMeasurable();

  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useLayoutEffect(() => {
    onResizeRef.current?.(width);
  }, [width]);

  return (
    <div className="ResizingInputText">
      <p
        className={[className, "ResizingInputText-measurable"].join(" ")}
        ref={measurableRef}
      >
        {value === "" ? placeholder : value}
      </p>
      <input
        {...props}
        ref={ref}
        className={[className, "ResizingInputText-input"].join(" ")}
        placeholder={placeholder}
        style={{ width: width + INPUT_SIZE_SAFETY_BUFFER }}
        type="text"
        value={value}
        onChange={onChange}
      />
    </div>
  );
});
