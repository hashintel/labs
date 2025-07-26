import React, { FC, RefObject } from "react";
import { useDispatch } from "react-redux";

import type { AppDispatch } from "../../../../features/types";
import { HashCoreFilesSearchInput } from "./HashCoreFilesSearchInput";
import {
  MonacoIconButton,
  MonacoIconCheckbox,
  MonacoIconToggle,
} from "./MonacoIconComponents";
import { Scope, useScope } from "../../../../features/scopes";
import { SearchDispatch, SearchState } from "./reducer";
import { closeSearch } from "../../../../features/search/slice";
import { replace } from "./util";
import { useCanHover } from "../../../../hooks/useCanHover";

import "./HashCoreFilesSearchForm.css";

export const HashCoreFilesSearchForm: FC<{
  searchState: SearchState;
  searchDispatch: SearchDispatch;
  searchInputRef: RefObject<HTMLInputElement>;
  replaceInputRef: RefObject<HTMLInputElement>;
}> = ({ searchState, searchDispatch, searchInputRef, replaceInputRef }) => {
  const { query, pending, results } = searchState;
  const appDispatch = useDispatch<AppDispatch>();
  const canEdit = useScope(Scope.edit);
  const canHover = useCanHover();

  return (
    <form
      onSubmit={(evt) => {
        evt.preventDefault();
      }}
      autoComplete="off"
    >
      <div className="HashCoreFilesSearchForm">
        {canEdit && canHover ? (
          <MonacoIconToggle
            className="HashCoreFilesSearchForm__Toggle"
            open={query.replacing}
            title="Toggle Replace Mode"
            onClick={(open) => {
              searchDispatch({
                type: "replacing",
                payload: !open,
              });
            }}
          />
        ) : null}
        <div className="HashCoreFilesSearchForm__Inputs">
          <div className="HashCoreFilesSearchForm__Section">
            <HashCoreFilesSearchInput
              inputClassName="HashCoreFilesSearchInput__search"
              name="searchTerm"
              value={query.searchTerm}
              ref={searchInputRef}
              onChange={(evt) =>
                searchDispatch({
                  type: "searchTerm",
                  payload: evt.target.value,
                })
              }
              placeholder="Search"
              icons={
                <>
                  <MonacoIconCheckbox
                    title="Match Case"
                    iconName="case-sensitive"
                    checked={query.caseSensitive}
                    onClick={(checked) => {
                      searchDispatch({
                        type: "caseSensitive",
                        payload: !checked,
                      });
                      searchInputRef.current?.focus();
                    }}
                  />
                  <MonacoIconCheckbox
                    title="Use Regular Expression"
                    iconName="regex"
                    checked={query.regex}
                    onClick={(checked) => {
                      searchDispatch({
                        type: "regex",
                        payload: !checked,
                      });
                      searchInputRef.current?.focus();
                    }}
                  />
                </>
              }
            />
            <MonacoIconButton
              iconName="close"
              title="Close"
              onClick={() => {
                appDispatch(closeSearch());
              }}
            />
          </div>
          {query.replacing ? (
            <div className="HashCoreFilesSearchForm__Section">
              <HashCoreFilesSearchInput
                inputClassName="HashCoreFilesSearchInput__replace"
                name="replaceTerm"
                value={query.replaceTerm}
                ref={replaceInputRef}
                onChange={(evt) =>
                  searchDispatch({
                    type: "replaceTerm",
                    payload: evt.target.value,
                  })
                }
                placeholder="Replace"
                icons={
                  <MonacoIconCheckbox
                    title="Preserve Case"
                    iconName="preserve-case"
                    checked={query.preserveCase}
                    onClick={(checked) => {
                      searchDispatch({
                        type: "preserveCase",
                        payload: !checked,
                      });
                      replaceInputRef.current?.focus();
                    }}
                  />
                }
              />
              <MonacoIconButton
                title="Replace All"
                iconName="replace-all"
                disabled={results.length === 0 || pending}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Would you like to replace all instances of ${query.searchTerm} with ${query.replaceTerm}?`,
                    )
                  ) {
                    return;
                  }

                  await Promise.all(
                    results.flatMap(({ model, file, matches }) =>
                      replace(model, file, matches),
                    ) ?? [],
                  );
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
};
