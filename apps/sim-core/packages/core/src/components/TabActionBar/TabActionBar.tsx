import React, {
  FC,
  MutableRefObject,
  ReactNode,
  useCallback,
  useEffect,
} from "react";
import { TabList, Tabs } from "react-tabs";
import classNames from "classnames";

import { useResizeObserver } from "../../hooks/useResizeObserver/useResizeObserver";
import { useScrollState } from "../../hooks/useScrollState";

import "./TabActionBar.scss";

export const TabActionBar: FC<{
  tabs: ReactNode;
  actions: ReactNode[];
  tabsRef: MutableRefObject<HTMLElement | null>;
  selectedIndex: number;
  onSelectedIndexChange?: (
    tabIndex: number,
    last: number,
    event: Event,
  ) => void;
  hidden?: boolean;
  className?: string;
}> = ({
  children,
  tabs,
  tabsRef,
  selectedIndex,
  onSelectedIndexChange = () => {},
  actions,
  hidden = false,
  className,
}) => {
  const makeCurrentTabVisible = useCallback(() => {
    if (!tabsRef.current) {
      return;
    }

    const node: HTMLElement | null =
      tabsRef.current.querySelectorAll<HTMLLIElement>(".react-tabs__tab")[
        selectedIndex
      ];

    node?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }, [selectedIndex, tabsRef]);

  useEffect(() => {
    makeCurrentTabVisible();
  }, [makeCurrentTabVisible]);

  const tabContainerResizeObserver = useResizeObserver(
    () => makeCurrentTabVisible(),
    { onObserve: null },
  );

  const [setScrollRef, fadeOutVisible] = useScrollState("horizontal");

  return (
    <Tabs
      selectedIndex={selectedIndex}
      onSelect={onSelectedIndexChange}
      domRef={(node) => {
        tabsRef.current = node ?? null;

        setScrollRef(node?.querySelector(".TabActionBar__TabContainer__Tabs"));
      }}
      className={classNames("TabActionBar react-tabs", className)}
    >
      <div
        ref={tabContainerResizeObserver}
        className={classNames("TabActionBar__TabContainer", {
          "TabActionBar__TabContainer--hidden": hidden,
        })}
      >
        <TabList
          onWheel={(evt) => {
            evt.currentTarget.scrollLeft += evt.deltaY * 8;
          }}
          className="TabActionBar__TabContainer__Tabs react-tabs__tab-list"
        >
          {tabs}
        </TabList>
        <ul
          className={classNames("react-tabs__tab-list TabActionBar__Actions", {
            "TabActionBar__Actions--fadeOut": fadeOutVisible,
          })}
        >
          {/**
           * @todo use non-index key
           */}
          {actions.map((action, idx) =>
            action ? (
              <li className="react-tabs__tab react-tabs__tab--button" key={idx}>
                {action}
              </li>
            ) : null,
          )}
        </ul>
      </div>
      {children}
    </Tabs>
  );
};
