import React, { FC, useEffect, useRef } from "react";
import classnames from "classnames";

import "./HashCoreFilesSearchProgress.css";

export const HashCoreFilesSearchProgress: FC<{ searching: boolean }> = ({
  searching,
}) => {
  const progressRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const progress = progressRef.current!;
    const currentlySearching = progress.classList.contains("active");

    if (currentlySearching === searching) {
      return;
    }

    if (searching) {
      progress.classList.remove("complete");
      progress.classList.add("active");
    } else {
      progress.style.width = `${progress.offsetWidth}px`;
      progress.classList.remove("active");
      progress.classList.add("complete");
    }
  }, [searching]);

  return (
    <div
      className={classnames("HashCoreFilesSearchProgress")}
      aria-hidden
      ref={progressRef}
      onAnimationEnd={(evt) => {
        if (evt.animationName.includes("Complete")) {
          const progress = progressRef.current!;

          progress.style.width = "";
          progress.classList.remove("complete");
          progress.classList.remove("complete");
        }
      }}
    />
  );
};
