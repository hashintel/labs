import React, { forwardRef, HTMLAttributes, ReactNode } from "react";

import { HashCoreFilesSearchFade } from "./HashCoreFilesSearchFade";

import "./HashCoreFilesSearchItemWithIcons.scss";

type HashCoreFilesSearchItemWithIconsProps = HTMLAttributes<HTMLDivElement> & {
  icons: ReactNode;
};

/**
 * Using a named function so the name shows up in dev tools despite forwardRef
 */
export const HashCoreFilesSearchItemWithIcons = forwardRef<
  HTMLDivElement,
  HashCoreFilesSearchItemWithIconsProps
>(function HashCoreFilesSearchItemWithIcons(
  { children, icons, ...props },
  ref
) {
  return (
    <div className="HashCoreFilesSearchItemWithIcons">
      <div ref={ref} {...props}>
        {children}
      </div>
      {icons ? (
        <div className="HashCoreFilesSearchItemWithIcons__Icons">
          <HashCoreFilesSearchFade />
          {icons}
        </div>
      ) : null}
    </div>
  );
});
