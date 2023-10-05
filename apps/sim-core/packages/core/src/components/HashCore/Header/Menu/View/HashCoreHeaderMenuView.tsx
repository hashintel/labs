import React, { FC, Fragment, memo, MouseEvent } from "react";
import { useDispatch, useSelector } from "react-redux";
import classNames from "classnames";

import { LabeledInputRadio } from "../../../../LabeledInputRadio";
import { Link } from "../../../../Link/Link";
import { Scope, useScopes } from "../../../../../features/scopes";
import { TabKind } from "../../../../../features/viewer/enums";
import { getMetaCharacter } from "../../../../../hooks/useKeyboardShortcuts";
import { openSearch } from "../../../../../features/search/slice";
import {
  selectActivityVisible,
  selectEditorVisible,
  selectViewerVisible,
} from "../../../../../features/viewer/selectors";
import { selectHasProject } from "../../../../../features/project/selectors";
import {
  toggleActivity,
  toggleEditor,
  toggleViewer,
} from "../../../../../features/viewer/slice";
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
    const dispatch = useDispatch();
    const { canEdit, canLogin } = useScopes(Scope.edit, Scope.login);
    const hasProject = useSelector(selectHasProject);
    const editorVisible = useSelector(selectEditorVisible);
    const activityVisible = useSelector(selectActivityVisible);
    const viewerVisible = useSelector(selectViewerVisible);

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
        ))
      );

      if (editorVisible) {
        items.push(
          <li className="HashCoreHeaderMenu-submenu-item" key="search">
            <a
              onClick={() => {
                clearAll();
                dispatch(openSearch());
              }}
            >
              {canEdit ? <>Search & Replace</> : <>Search</>}
            </a>
          </li>
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
              dispatch(toggleEditor());
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
              dispatch(toggleViewer());
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
                dispatch(toggleActivity());
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
      </Fragment>
    );

    if (canLogin) {
      items.push(
        <Fragment key="account">
          {items.length ? (
            <li>
              <hr />
            </li>
          ) : null}
          <li className="HashCoreHeaderMenu-submenu-item">
            <Link path="/signup" onClick={clearAll}>
              Sign up
            </Link>
          </li>
          <li className="HashCoreHeaderMenu-submenu-item">
            <Link path="/signin" onClick={clearAll}>
              Sign in
            </Link>
          </li>
        </Fragment>
      );
    }

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
  }
);

// // @ts-ignore
// HashCoreHeaderMenuView.whyDidYouRender = {
//   customName: "HashCoreHeaderMenuView"
// };
