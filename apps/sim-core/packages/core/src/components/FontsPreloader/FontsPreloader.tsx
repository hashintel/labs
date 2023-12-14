import React, { FC, useEffect, useState, Fragment, CSSProperties } from "react";
import { createPortal } from "react-dom";

const fontsToPreload: [string, CSSProperties[]][] = Object.entries({
  Inter: [
    {
      fontWeight: "normal",
    },
    {
      fontWeight: "bold",
    },
    {
      fontWeight: 900,
    },
    {
      fontStyle: "italic",
    },
    {
      fontStyle: "italic",
      fontWeight: "bold",
    },
  ],
  "Apercu Mono": [{ fontWeight: "normal" }, { fontWeight: "bold" }],
});

export const FontsPreloader: FC = ({ children }) => {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.body);
  }, []);

  return (
    <>
      {children}
      {target &&
        createPortal(
          <div
            aria-hidden
            style={{
              position: "absolute",
              opacity: 0,
              top: 0,
              left: 0,
              pointerEvents: "none",
            }}
          >
            {fontsToPreload.map(([fontFamily, styles]) => (
              <Fragment key={fontFamily}>
                {styles.map((style, idx) => (
                  <span key={idx} style={{ fontFamily, ...style }} />
                ))}
              </Fragment>
            ))}
          </div>,
          target,
        )}
    </>
  );
};
