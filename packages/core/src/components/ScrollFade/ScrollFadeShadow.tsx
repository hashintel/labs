import React, { FC, useEffect, useState } from "react";
import classNames from "classnames";

import "./ScrollFadeShadow.scss";

export const ScrollFadeShadow: FC<{ visible: boolean; className?: string }> = ({
  visible,
  className,
}) => {
  const [transitionEnabled, setTransitionEnabled] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setTransitionEnabled(true);
    }, 100);

    return () => {
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div
      className={classNames("ScrollFadeShadow", className, {
        "ScrollFadeShadow--transition": transitionEnabled,
      })}
      style={{ opacity: visible ? 1 : 0 }}
    />
  );
};
