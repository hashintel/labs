import { useState, MouseEvent, RefObject, useMemo } from "react";
import { debounce } from "lodash";

import { useClickOutside } from "./useClickOutside";

interface MenuInterface {
  menuRef: RefObject<HTMLUListElement>;
  openMenuItem: string;
  openSubmenuItem: string;
  clearAll: () => void;
  onClickMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterSubmenuItemLabel: ({
    target,
  }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterSubmenuItem: ({ target }: MouseEvent<HTMLLIElement>) => void;
  onMouseLeaveSubmenuItem: ({ target }: MouseEvent<HTMLLIElement>) => void;
}

function isHtmlLabelElement(target: EventTarget): target is HTMLLabelElement {
  return target instanceof HTMLLabelElement;
}

const noItem = "";
const debounced = debounce((fn) => fn(), 200);
const onMouseEnterSubmenuItem = () => {
  /**
   * if we have entered a submenu item (i.e. an
   * `li.HashCoreHeaderMenu-submenu-item`) and there's a debounced state
   * update pending, cancel it
   *
   * this gets triggered *before* `onMouseEnterSubmenuItemLabel`, so if a user
   * has legitimately moused into another submenu item (label) that state
   * update still gets scheduled
   *
   * if a user has moused over/past a submenu item label and into a submenu
   * (i.e. an `li.HashCoreHeaderMenu-submenu-item > ul`) the fact that the
   * `ul` is contained by the `li.HashCoreHeaderMenu-submenu-item` will cause
   * this to (re)fire and cancel the pending state update triggered by the
   * intervening call to `onMouseEnterSubmenuItemLabel`
   */
  debounced.cancel();
};

export function useMenu(): MenuInterface {
  const [openMenuItem, setOpenMenuItem] = useState(noItem);
  const [openSubmenuItem, setOpenSubmenuItem] = useState(noItem);

  const {
    clearAll,
    onClickMenuItemLabel,
    onMouseEnterMenuItemLabel,
    onMouseEnterSubmenuItemLabel,
    onMouseLeaveSubmenuItem,
  } = useMemo(
    () => ({
      clearAll: () => {
        setOpenMenuItem(noItem);
        setOpenSubmenuItem(noItem);
      },

      onClickMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => {
        if (!isHtmlLabelElement(target)) {
          return;
        }

        const { htmlFor } = target;
        setOpenMenuItem((prev) => (prev === htmlFor ? noItem : htmlFor));
      },

      onMouseEnterMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => {
        if (!isHtmlLabelElement(target)) {
          return;
        }

        const { htmlFor } = target;

        debounced(() => {
          /**
           * n.b. compares previous `openMenuItem` to `noItem` ... if a user moused
           * over this menu item and no item was previously selected we don't want
           * to open a new menu on mouse enter, if however an item *was* previously
           * selected we must have moved from one open menu to another and should
           * update the open menu item accordingly
           */
          setOpenMenuItem((prev) => (prev === noItem ? noItem : htmlFor));
          setOpenSubmenuItem(noItem);
        });
      },

      onMouseEnterSubmenuItemLabel: ({
        target,
      }: MouseEvent<HTMLLabelElement>) => {
        if (!isHtmlLabelElement(target)) {
          return;
        }

        const { htmlFor } = target;

        debounced(() => {
          setOpenSubmenuItem(htmlFor);
        });
      },

      onMouseLeaveSubmenuItem: ({ target }: MouseEvent<HTMLLIElement>) => {
        if (!isHtmlLabelElement(target)) {
          return;
        }

        debounced(() => {
          setOpenSubmenuItem(noItem);
        });
      },
    }),
    [setOpenMenuItem, setOpenSubmenuItem],
  );

  // @todo use useOnClickOutside
  const menuRef = useClickOutside<HTMLUListElement>(clearAll);

  return {
    menuRef,
    openMenuItem,
    openSubmenuItem,
    clearAll,
    onClickMenuItemLabel,
    onMouseEnterMenuItemLabel,
    onMouseEnterSubmenuItemLabel,
    onMouseEnterSubmenuItem,
    onMouseLeaveSubmenuItem,
  };
}
