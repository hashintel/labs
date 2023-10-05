import { useState, RefCallback } from "react";

import { useResizeObserver } from "../../../hooks/useResizeObserver/useResizeObserver";

export function useMeasurable<NodeType extends HTMLElement>(): [
  RefCallback<NodeType>,
  number
] {
  const [width, setWidth] = useState(0);

  const setObserver = useResizeObserver<NodeType>((entry) =>
    setWidth(Math.ceil(entry.width))
  );

  return [setObserver, width];
}
