import React, {
  FC,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { IconChevronRight } from "../Icon/ChevronRight";
import { Projection } from "./types";
import { useResizeObserver } from "../../hooks/useResizeObserver/useResizeObserver";

import "./BehaviorKeysProjection.scss";

const getContentWidth = (element: HTMLDivElement): number => {
  const styles = getComputedStyle(element);

  return (
    element.clientWidth -
    parseFloat(styles.paddingLeft) -
    parseFloat(styles.paddingRight)
  );
};

export const BehaviorKeysProjection: FC<{
  projection: Projection;
  onProjectionChange: (newProjection: Projection) => void;
}> = ({ projection, onProjectionChange }) => {
  const projectionRef = useRef<HTMLDivElement | null>(null);

  const defaultDisplayState = {
    index: -Infinity,
    projection,
    toCalculate: true,
  };
  const [displayState, setDisplayState] = useState(defaultDisplayState);

  if (displayState.projection !== projection) {
    setDisplayState(defaultDisplayState);
  }

  const calculateDisplayState = () => {
    if (projectionRef.current && displayState.toCalculate) {
      const [header, collapsed, ...crumbs] = Array.from(
        projectionRef.current.children
      ) as HTMLElement[];

      if (crumbs.length === 0) {
        setDisplayState((prevDisplayState) => ({
          ...prevDisplayState,
          idx: 0,
          toCalculate: false,
        }));
      } else {
        collapsed.style.display = "";

        const collapsedWidth = collapsed.offsetWidth;
        collapsed.style.display = "none";

        const width = getContentWidth(projectionRef.current);
        const availableWidth = width - header.offsetWidth;

        collapsed.style.display = "";

        const { idx } = crumbs.reduceRight(
          (prev, node, idx) => {
            if (!prev.done) {
              const nodeWidth = node.offsetWidth;
              const nextAvailableWidth = prev.width - nodeWidth;
              const threshold = idx === 0 ? 0 : collapsedWidth;

              if (nextAvailableWidth <= threshold) {
                return { ...prev, done: true };
              }

              return { width: nextAvailableWidth, idx, done: false };
            }

            return prev;
          },
          { width: availableWidth, idx: Infinity, done: false }
        );

        if (idx < Infinity) {
          setDisplayState((prevDisplayState) => ({
            ...prevDisplayState,
            index: idx,
            toCalculate: false,
          }));
        }
      }
    }
  };

  const calculateDisplayStateRef = useRef(calculateDisplayState);

  useLayoutEffect(() => {
    calculateDisplayStateRef.current = calculateDisplayState;
    calculateDisplayStateRef.current();
  });

  const setResizeObserver = useResizeObserver(() => {
    setDisplayState(defaultDisplayState);
  });

  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      projectionRef.current = node;
      setResizeObserver(node);
    },
    [setResizeObserver]
  );

  return (
    <div className="BehaviorKeys__Projection" ref={mergedRef}>
      <button
        className="BehaviorKeys__Projection__Crumb BehaviorKeys__Projection__Crumb--title"
        disabled={!projection.length}
        onClick={(evt) => {
          evt.preventDefault();

          onProjectionChange([]);
        }}
      >
        <span>Behavior Keys</span>
        <IconChevronRight size={23} />
      </button>
      {displayState.index > 0 || displayState.toCalculate ? (
        <button
          onClick={(evt) => {
            evt.preventDefault();

            onProjectionChange(projection.slice(0, -1));
          }}
          className="BehaviorKeys__Projection__Crumb"
        >
          <span>...</span>
          <IconChevronRight size={23} />
        </button>
      ) : null}
      {projection.map(({ label }, idx) => {
        if (idx < displayState.index) return null;
        return (
          <button
            onClick={(evt) => {
              evt.preventDefault();

              onProjectionChange(projection.slice(0, idx + 1));
            }}
            key={idx}
            title={label}
            className="BehaviorKeys__Projection__Crumb"
          >
            <span>{label}</span>
            <IconChevronRight size={23} />
          </button>
        );
      })}
    </div>
  );
};
