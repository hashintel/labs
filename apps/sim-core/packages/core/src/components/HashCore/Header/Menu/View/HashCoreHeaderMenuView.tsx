import React, { FC, Fragment, memo, MouseEvent } from "react";
import classNames from "classnames";

import { LabeledInputRadio } from "../../../../LabeledInputRadio";
import { Scope, useScope } from "../../../../../features/scopes";
import { TabKind } from "../../../../../features/viewer/enums";
import { getMetaCharacter } from "../../../../../hooks/useKeyboardShortcuts";
import { useProject } from "../../../../../features/project/ProjectContext";
import { useSearch } from "../../../../../features/search/SearchContext";
import { useViewer } from "../../../../../features/viewer/ViewerContext";
import { viewerTabs } from "../../../../../features/viewer/utils";

type HashCoreHeaderMenuViewProps = {
  openMenuItem: string;
  onClickMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  onAddView: (tabName: TabKind) => void;
  clearAll: () => void;
};

export const HashCoreHeaderMenuView: FC<HashCoreHeaderMenuViewProps> = memo(
  ({
    openMenuItem,
    onClickMenuItemLabel,
    onMouseEnterMenuItemLabel,
    onAddView,
    clearAll,
  }) => {
    const { openSearch } = useSearch();
    const canEdit = useScope(Scope.edit);
    const { hasProject } = useProject();
    const {
      editorVisible,
      activityVisible,
      viewerVisible,
      toggleActivity,
      toggleEditor,
      toggleViewer,
    } = useViewer();

    const items = [];

    if (hasProject) {
      items.push(
        ...viewerTabs.map((tab) => (
          <li className="HashCoreHeaderMenu-submenu-item" key={tab.kind}>
            <a
              onClick={() => {
                onAddView(tab.kind);
                clearAll();
              }}
            >
              {tab.name}
            </a>
          </li>
        )),
      );

      if (editorVisible) {
        items.push(
          <li className="HashCoreHeaderMenu-submenu-item" key="search">
            <a
              onClick={() => {
                clearAll();
                openSearch();
              }}
            >
              {canEdit ? <>Search & Replace</> : <>Search</>}
            </a>
          </li>,
        );
      }
    }

    items.push(
      <Fragment key="views">
        {items.length ? (
          <li>
            <hr />
          </li>
        ) : null}
        <li className="HashCoreHeaderMenu-submenu-item">
          <a
            onClick={() => {
              clearAll();
              toggleEditor();
            }}
          >
            <div className="HashCoreHeaderMenu__LabelWithHint">
              <span>{editorVisible ? <>Hide Editor</> : <>Show Editor</>}</span>
              <div className="HashCoreHeaderMenu__LabelWithHint__Hint">
                <span>{getMetaCharacter()}</span>
                <span>Shift</span>
                <span>E</span>
              </div>
            </div>
          </a>
        </li>
        <li className="HashCoreHeaderMenu-submenu-item">
          <a
            onClick={() => {
              clearAll();
              toggleViewer();
            }}
          >
            <div className="HashCoreHeaderMenu__LabelWithHint">
              <span>
                {activityVisible ? <>Hide Viewer</> : <>Show Viewer</>}
              </span>
              <div className="HashCoreHeaderMenu__LabelWithHint__Hint">
                <span>{getMetaCharacter()}</span>
                <span>Shift</span>
                <span>Y</span>
              </div>
            </div>
          </a>
        </li>
        <li
          className={classNames("HashCoreHeaderMenu-submenu-item", {
            "HashCoreHeaderMenu-submenu-item--disabled": !viewerVisible,
          })}
        >
          <a
            onClick={() => {
              if (viewerVisible) {
                clearAll();
                toggleActivity();
              }
            }}
          >
            <div className="HashCoreHeaderMenu__LabelWithHint">
              <span>
                {activityVisible && viewerVisible ? (
                  <>Hide Activity</>
                ) : (
                  <>Show Activity</>
                )}
              </span>
              <div className="HashCoreHeaderMenu__LabelWithHint__Hint">
                <span>{getMetaCharacter()}</span>
                <span>Shift</span>
                <span>A</span>
              </div>
            </div>
          </a>
        </li>
      </Fragment>,
    );

    return (
      <>
        <LabeledInputRadio
          group="HashCoreHeaderMenu"
          label="View"
          isChecked={(htmlFor) => htmlFor === openMenuItem}
          onClick={onClickMenuItemLabel}
          onMouseEnter={onMouseEnterMenuItemLabel}
          disabled={items.length === 0}
        />
        <ul className="HashCoreHeaderMenu-submenu">{items}</ul>
      </>
    );
  },
);
