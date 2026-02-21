import React, { FC, memo, useCallback } from "react";

import { HashCoreHeaderMenuExperiments } from "./Experiments";
import { HashCoreHeaderMenuFiles } from "./Files";
import { HashCoreHeaderMenuHelp } from "./Help";
import { HashCoreHeaderMenuView } from "./View";
import { TabKind } from "../../../../features/viewer/enums";
import { useExamples } from "../../../../features/examples/ExamplesContext";
import { useMenu } from "./hooks";
import { useUser } from "../../../../features/user/UserContext";
import { useViewer } from "../../../../features/viewer/ViewerContext";

import "./HashCoreHeaderMenu.scss";

/**
 * @todo nathggns: Look into removing memo and useCallback in here
 */
export const HashCoreHeaderMenu: FC = memo(() => {
  const { userProjects } = useUser();
  const { examples } = useExamples();
  const { openTab } = useViewer();

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
    (tab: TabKind) => {
      openTab(tab);
    },
    [openTab],
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
