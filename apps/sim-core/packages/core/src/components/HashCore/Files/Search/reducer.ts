import { Dispatch, useEffect, useReducer } from "react";
import { useSelector } from "react-redux";
import produce, { Draft } from "immer";

import {
  SearchFileResult,
  SearchQuery,
  SearchResultsDictionary,
} from "./types";
import { selectCurrentProjectUrl } from "../../../../features/project/selectors";
import { useFilesRemovedObservable } from "./hooks";

export type SearchAction =
  | {
      type: "searchTerm";
      payload: SearchQuery["searchTerm"];
    }
  | {
      type: "replaceTerm";
      payload: SearchQuery["replaceTerm"];
    }
  | {
      type: "replacing";
      payload: SearchQuery["replacing"];
    }
  | {
      type: "caseSensitive";
      payload: SearchQuery["caseSensitive"];
    }
  | {
      type: "regex";
      payload: SearchQuery["regex"];
    }
  | { type: "preserveCase"; payload: SearchQuery["preserveCase"] }
  | { type: "results"; payload: SearchResultsDictionary }
  | { type: "pending" }
  | { type: "reset"; payload: { projectUrl: string | null } }
  | { type: "filesRemoved"; payload: string[] };

export type SearchState = {
  query: SearchQuery;
  resultsMap: SearchResultsDictionary;
  results: SearchFileResult[];
  noResults: boolean;
  pending: boolean;
  projectUrl: string | null;
};

export type SearchDispatch = Dispatch<SearchAction>;

const searchInitialState: SearchState = {
  query: {
    caseSensitive: false,
    regex: false,
    replacing: false,
    searchTerm: "",
    replaceTerm: "",
    preserveCase: false,
  },
  pending: false,
  noResults: false,
  resultsMap: {},
  results: [],
  projectUrl: null,
};

/**
 * We store search results as a dictionary of the file id against the an object
 * representing the search results (so that we can incrementally update it),
 * however, most consumers will want results as an iterable array. Rather than
 * computing this wherever we need it, we have what is essentially a computed
 * property that we update whenever we set results.
 */
const setResults = (
  state: Draft<SearchState>,
  results: SearchResultsDictionary | null
) => {
  state.resultsMap = results ?? {};
  state.results = results
    ? Object.values(results).filter((result) => result.matches.length > 0)
    : [];
  state.pending = false;
  state.noResults = results ? state.results.length === 0 : false;
};

/**
 * Typing explicitly because immer combined with useReducer seems to result in
 * some odd typing issues.
 */
const searchReducer: (
  state: SearchState,
  action: SearchAction
) => SearchState = produce(
  (state: Draft<SearchState>, action: SearchAction) => {
    if (action.type === "reset") {
      return {
        ...searchInitialState,
        projectUrl: action.payload.projectUrl,
      };
    }

    const originalPending = state.pending;

    state.pending = !!(action.type === "searchTerm"
      ? action.payload
      : state.query.searchTerm);

    switch (action.type) {
      case "caseSensitive":
        if (action.payload !== state.query.caseSensitive) {
          state.query.caseSensitive = action.payload;
          state.pending = !!state.query.searchTerm;
        }
        break;

      case "pending":
        state.pending = true;
        break;

      case "regex":
        if (action.payload !== state.query.regex) {
          state.query.regex = action.payload;
          state.pending = !!state.query.searchTerm;
        }
        break;

      case "replacing":
        if (action.payload !== state.query.replacing) {
          state.query.replacing = action.payload;
          state.pending = !!state.query.searchTerm;
          state.query.replaceTerm = "";
        }
        break;

      case "replaceTerm":
        if (action.payload !== state.query.replaceTerm) {
          state.query.replaceTerm = action.payload;
          state.pending = !!state.query.searchTerm;
        }
        break;

      case "searchTerm":
        if (action.payload !== state.query.searchTerm) {
          state.query.searchTerm = action.payload;

          if (action.payload) {
            state.pending = true;
          } else {
            setResults(state, null);
          }
        }
        break;

      case "preserveCase":
        if (action.payload !== state.query.preserveCase) {
          state.query.preserveCase = action.payload;
          state.pending = !!state.query.searchTerm;
        }
        break;

      case "results":
        setResults(state, action.payload);
        break;

      case "filesRemoved":
        state.pending = originalPending;

        if (state.results.length > 0) {
          for (const id of action.payload) {
            if (state.resultsMap[id]) {
              delete state.resultsMap[id];
            }
          }

          setResults(state, state.resultsMap);
          if (state.noResults && !state.query.searchTerm) {
            state.noResults = false;
          }
        }
    }
  }
);

export const useSearchReducer = () => {
  const [searchState, searchDispatch] = useReducer(
    searchReducer,
    searchInitialState
  );

  const projectUrl = useSelector(selectCurrentProjectUrl);
  if (searchState.projectUrl !== projectUrl) {
    searchDispatch({ type: "reset", payload: { projectUrl } });
  }

  const filesRemovedObserver = useFilesRemovedObservable();

  useEffect(() => {
    const subscription = filesRemovedObserver.subscribe((ids) => {
      searchDispatch({ type: "filesRemoved", payload: ids });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [filesRemovedObserver]);

  return [searchState, searchDispatch] as const;
};
