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
            <a href="https://docs.hash.ai/core/" target="_blank" rel="noopener noreferrer">
              Docs
            </a>
          </li>
          <li className="HashCoreHeaderMenu-submenu-item">
            <a
              href="https://github.com/hashintel/labs/issues/new/choose"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an issue
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
  },
);
