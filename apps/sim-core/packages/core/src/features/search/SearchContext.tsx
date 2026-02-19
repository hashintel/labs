import React, { createContext, FC, PropsWithChildren, useCallback, useContext, useState } from "react";

interface SearchContextValue {
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export const useSearch = () => {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be inside SearchProvider");
  return ctx;
};

export const SearchProvider: FC<PropsWithChildren> = ({ children }) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  return (
    <SearchContext.Provider value={{ searchOpen, openSearch, closeSearch }}>
      {children}
    </SearchContext.Provider>
  );
};
