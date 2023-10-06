import React, { FC, memo, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";

import { AppDispatch } from "../../../../features/types";
import { HashCoreHeaderMenuExperiments } from "./Experiments";
import { HashCoreHeaderMenuFiles } from "./Files";
import { HashCoreHeaderMenuHelp } from "./Help";
import { HashCoreHeaderMenuView } from "./View";
import { openTab } from "../../../../features/viewer/slice";
import { selectExamples } from "../../../../features/examples/selectors";
import { selectUserProjects } from "../../../../features/user/selectors";
import { useMenu } from "./hooks";

import "./HashCoreHeaderMenu.scss";

/**
 * @todo nathggns: Look into removing memo and useCallback in here
 */
export const HashCoreHeaderMenu: FC = memo(() => {
  const dispatch = useDispatch<AppDispatch>();
  const userProjects = useSelector(selectUserProjects);
  const examples = useSelector(selectExamples);

  const {
    menuRef,
    openMenuItem,
    openSubmenuItem,
    clearAll,
    onClickMenuItemLabel,
    onMouseEnterMenuItemLabel,
    onMouseEnterSubmenuItemLabel,
    onMouseEnterSubmenuItem,
    onMouseLeaveSubmenuItem,
  } = useMenu();

  const onAddView = useCallback(
    (tab) => {
      dispatch(openTab(tab));
    },
    [dispatch]
  );

  return (
    <ul className="HashCoreHeaderMenu" ref={menuRef}>
      <li className="HashCoreHeaderMenu-item">
        <HashCoreHeaderMenuFiles
          openMenuItem={openMenuItem}
          openSubmenuItem={openSubmenuItem}
          clearAll={clearAll}
          onClickMenuItemLabel={onClickMenuItemLabel}
          onMouseEnterMenuItemLabel={onMouseEnterMenuItemLabel}
          onMouseEnterSubmenuItemLabel={onMouseEnterSubmenuItemLabel}
          onMouseEnterSubmenuItem={onMouseEnterSubmenuItem}
          onMouseLeaveSubmenuItem={onMouseLeaveSubmenuItem}
          userProjects={userProjects}
          exampleProjects={examples}
        />
      </li>
      <li className="HashCoreHeaderMenu-item">
        <HashCoreHeaderMenuView
          openMenuItem={openMenuItem}
          onClickMenuItemLabel={onClickMenuItemLabel}
          onMouseEnterMenuItemLabel={onMouseEnterMenuItemLabel}
          onAddView={onAddView}
          clearAll={clearAll}
        />
      </li>
      <li className="HashCoreHeaderMenu-item">
        <HashCoreHeaderMenuExperiments
          openMenuItem={openMenuItem}
          onClickMenuItemLabel={onClickMenuItemLabel}
          onMouseEnterMenuItemLabel={onMouseEnterMenuItemLabel}
          clearAll={clearAll}
        />
      </li>
      <li className="HashCoreHeaderMenu-item">
        <HashCoreHeaderMenuHelp
          openMenuItem={openMenuItem}
          onClickMenuItemLabel={onClickMenuItemLabel}
          onMouseEnterMenuItemLabel={onMouseEnterMenuItemLabel}
          clearAll={clearAll}
        />
      </li>
      {/* <li className="HashCoreHeaderMenu-item">
        <HashCoreHeaderMenuCloudStatus />
      </li> */}
    </ul>
  );
});

// // @ts-ignore
// HashCoreHeaderMenu.whyDidYouRender = {
//   customName: "HashCoreHeaderMenu"
// };
