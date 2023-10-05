import React, { FC, memo, useLayoutEffect, useRef } from "react";
// @ts-ignore
import GradientPath from "gradient-path";

import { IconLoadingProps } from "./types";
import { theme } from "../../../util/theme";
import { useSyncAnimations } from "../../../hooks/useSyncAnimations";

import "./IconLoading.scss";
import "../Icon.css";

const size = 10;

const getPathCacheKey = (props: IconLoadingProps) =>
  `${props.start}/${props.end};`;
const pathCache: Record<string, string> = {};

/**
 * This is a fairly complex component because it allows you to fade between two
 * colors.
 *
 * @todo this should take a parent node ref in order to detect the background
 *       color from
 */
export const IconLoading: FC<IconLoadingProps> = memo(function IconLoading({
  start = theme["yellow-alt"],
  end,
}) {
  const ref = useRef<SVGSVGElement>(null);
  const pathsRef = useRef<string | null>(null);

  useSyncAnimations(ref, ".IconLoading");

  useLayoutEffect(() => {
    const svg = ref.current!;

    const cacheKey = getPathCacheKey({ start, end });

    if (pathCache[cacheKey]) {
      svg.innerHTML = pathCache[cacheKey];
    } else {
      /**
       * This restores the component back to it was before the last time the
       * effect fired
       */
      if (pathsRef.current) {
        svg.innerHTML = pathsRef.current;
      } else {
        pathsRef.current = svg.innerHTML;
      }

      const path = svg.querySelector("path");
      const colors = [
        { color: start, pos: 0 },
        { color: start, pos: 0.6 },
        { color: end, pos: 1 },
      ];

      const gp = new GradientPath({
        path,
        segments: size,
        samples: 3,
      });

      gp.render({
        type: "path",
        fill: colors,
        stroke: colors,
        strokeWidth: 0.5,
        width: parseInt(path!.getAttribute("stroke-width")!, 10),
      });

      /**
       * The first and last paths are corrupted due to a bug in gradient-path.
       * Luckily, we can remove these paths and not notice due to the small
       * size of this icon.
       *
       * @todo remove this when the bug is fixed
       * @see https://github.com/mnsht/gradient-path/issues/13
       */
      const paths = svg.querySelectorAll("path");
      paths[0].parentNode!.removeChild(paths[0]);
      paths[paths.length - 1].parentNode!.removeChild(paths[paths.length - 1]);

      pathCache[cacheKey] = svg.innerHTML;
    }
  }, [end, start]);

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 500 500"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      className="Icon IconLoading"
    >
      <path d="M250,25 C125,25 25,125 25,250" fill="none" strokeWidth="50px" />
    </svg>
  );
});
