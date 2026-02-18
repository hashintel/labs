import React, { FC, memo, MouseEvent } from "react";
import { useDispatch } from "react-redux";

import { LabeledInputRadio } from "../../../../LabeledInputRadio";
import { trackEvent } from "../../../../../features/analytics";
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
    const dispatch = useDispatch();

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
              onClick={() =>
                dispatch(
                  trackEvent({
                    action: "Docs Link Clicked: Core",
                    label: "Homepage",
                  })
                )
              }
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
