import React, { FC, memo, MouseEvent } from "react";

import { LabeledInputRadio } from "../../../../LabeledInputRadio";

import { useProject } from "../../../../../features/project/ProjectContext";
import { useTour } from "../../../Tour";

type HashCoreHeaderMenuHelpProps = {
  openMenuItem: string;
  onClickMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  clearAll: () => void;
};

export const HashCoreHeaderMenuHelp: FC<HashCoreHeaderMenuHelpProps> = memo(
  ({
    openMenuItem,
    onClickMenuItemLabel,
    onMouseEnterMenuItemLabel,
    clearAll,
  }) => {
    const tour = useTour();
    // const canUseAccount = useScope(Scope.useAccount);
    const { hasProject } = useProject();

    return (
      <>
        <LabeledInputRadio
          group="HashCoreHeaderMenu"
          label="Help"
          isChecked={(htmlFor) => htmlFor === openMenuItem}
          onClick={onClickMenuItemLabel}
          onMouseEnter={onMouseEnterMenuItemLabel}
        />
        <ul className="HashCoreHeaderMenu-submenu">
          <li className="HashCoreHeaderMenu-submenu-item">
            <a
              href="https://docs.hash.ai/core/"
              target="_blank"
            >
              Docs
            </a>
          </li>
          {/* {canUseAccount ? (
            <li className="HashCoreHeaderMenu-submenu-item">
              <a href={ACCOUNT_URL} target="_blank">
                My Account
              </a>
            </li>
          ) : null} */}
          {hasProject ? (
            <li className="HashCoreHeaderMenu-submenu-item">
              <a
                href="#"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  event.stopPropagation();
                  clearAll();
                  tour.start();
                }}
              >
                New User Tour
              </a>
            </li>
          ) : null}
        </ul>
      </>
    );
  }
);

// // @ts-ignore
// HashCoreHeaderMenuHelp.whyDidYouRender = {
//   customName: "HashCoreHeaderMenuHelp"
// };
