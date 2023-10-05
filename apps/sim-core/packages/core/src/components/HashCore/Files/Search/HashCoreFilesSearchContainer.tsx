import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";

import { HashCoreFilesSearch } from "./HashCoreFilesSearch";
import {
  closeSearch,
  openSearch,
  selectSearchOpen,
} from "../../../../features/search";
import { focusAndSelect } from "./util";
import { useKeyboardShortcuts } from "../../../../hooks/useKeyboardShortcuts";
import { useSearchReducer } from "./reducer";

/**
 * This is a container that stores the state for our search panel and also
 * attaches keyboard events (so that keyboard shortcuts work even when the
 * panel is not open).
 */
export const HashCoreFilesSearchContainer = () => {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const searchOpen = useSelector(selectSearchOpen);
  const appDispatch = useDispatch();
  const [searchState, searchDispatch] = useSearchReducer();

  const ensureOpen = () => {
    if (!searchOpen) {
      appDispatch(openSearch());
    }
  };

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const openProjectWideSearch = () => {
    ensureOpen();

    if (searchState.query.replacing) {
      searchDispatch({ type: "replacing", payload: false });
    }

    focusAndSelect(searchInputRef.current);
  };
  useKeyboardShortcuts({
    meta: {
      f: openProjectWideSearch,
    },
    metaShift: {
      f: openProjectWideSearch,
    },
    single: {
      Escape: () => {
        if (searchOpen) {
          appDispatch(closeSearch());
        }
      },
    },
  });

  return searchOpen ? (
    <HashCoreFilesSearch
      searchState={searchState}
      searchDispatch={searchDispatch}
      searchInputRef={searchInputRef}
      replaceInputRef={replaceInputRef}
    />
  ) : null;
};
