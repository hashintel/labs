import { useEffect, useRef, useState } from "react";

export const useHover = <T extends HTMLElement>(disabled?: boolean) => {
  const [value, setValue] = useState(false);

  if (disabled && value) {
    setValue(false);
  }

  const ref = useRef<T>(null);

  const handleMouseOver = () => setValue(true);
  const handleMouseOut = () => setValue(false);

  useEffect(() => {
    const node = ref.current;
    if (node && !disabled) {
      node.addEventListener("mouseover", handleMouseOver);
      node.addEventListener("mouseout", handleMouseOut);

      return () => {
        node.removeEventListener("mouseover", handleMouseOver);
        node.removeEventListener("mouseout", handleMouseOut);
      };
    }
  }, [disabled]);

  return [ref, value] as const;
};
