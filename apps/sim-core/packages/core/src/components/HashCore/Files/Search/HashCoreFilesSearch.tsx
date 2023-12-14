import React, { FC, RefObject } from "react";

import { HashCoreFilesSearchFile } from "./HashCoreFilesSearchFile";
import { HashCoreFilesSearchForm } from "./HashCoreFilesSearchForm";
import { HashCoreFilesSearchProgress } from "./HashCoreFilesSearchProgress";
import { KeepInViewProvider } from "../../../KeepInView";
import { SearchDispatch, SearchState } from "./reducer";
import { replace } from "./util";
import {
  useMonacoSearchHighlightDecorator,
  useReplaceProposal,
  useRevealMatchInEditor,
  useSearch,
} from "./hooks";

import "./HashCoreFilesSearch.css";

export const HashCoreFilesSearch: FC<{
  searchState: SearchState;
  searchDispatch: SearchDispatch;
  searchInputRef: RefObject<HTMLInputElement>;
  replaceInputRef: RefObject<HTMLInputElement>;
}> = ({ searchState, searchDispatch, searchInputRef, replaceInputRef }) => {
  const { query, pending, results, noResults } = searchState;
  const revealSelection = useRevealMatchInEditor();

  useSearch(searchState, searchDispatch);
  useMonacoSearchHighlightDecorator(results);
  useReplaceProposal(query.replacing, results);

  return (
    <KeepInViewProvider className="HashCoreFilesSearch">
      <HashCoreFilesSearchProgress searching={pending} />
      <HashCoreFilesSearchForm
        searchState={searchState}
        searchDispatch={searchDispatch}
        searchInputRef={searchInputRef}
        replaceInputRef={replaceInputRef}
      />
      {noResults ? <p>No results</p> : null}
      <ul>
        {results.map(({ file, model, matches, replacing }) => (
          <li key={file.id}>
            <HashCoreFilesSearchFile
              file={file}
              matches={matches}
              onClick={(match) => {
                const range = match.range;
                const replacing = query.replacing;

                revealSelection(replacing, file, model, matches, range);
              }}
              onFileClick={(file) => {
                revealSelection(replacing, file, model, matches);
              }}
              onReplace={async (match) => {
                await replace(model, file, [
                  {
                    range: match.range,
                    replaceTerm: match.replaceTerm,
                  },
                ]);
              }}
              onReplaceAllInFile={async () => {
                if (
                  !window.confirm(
                    `Would you like to replace all instances of ${query.searchTerm} with ${query.replaceTerm} in this file?`,
                  )
                ) {
                  return;
                }

                await replace(model, file, matches);
              }}
              replacing={replacing}
              pending={pending}
            />
          </li>
        ))}
      </ul>
    </KeepInViewProvider>
  );
};
