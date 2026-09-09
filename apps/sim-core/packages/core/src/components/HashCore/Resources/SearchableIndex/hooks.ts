import { useEffect, useReducer, useRef } from "react";

import type { ResourceProject } from "../../../../features/project/types";
import { Scope, useScope } from "../../../../features/scopes";
import { searchResourceProjects } from "../../../../util/api/queries/searchResourceProjects";

import { useProject } from "../../../../features/project/ProjectContext";

export const useSearchIndex = (): {
  loading: boolean;
  results: ResourceProject[];
  onChange: (term: string) => void;
  searchTerm: string;
} => {
  const { currentProject, projectLoaded } = useProject();
  const canSave = useScope(Scope.save);
  const latestReleaseTag = currentProject?.latestRelease?.tag;

  const [{ loading, results, searchTerm }, dispatch] = useReducer(
    (
      state: {
        loading: boolean;
        results: ResourceProject[];
        searchTerm: string;
      },
      action:
        | { type: "SEARCH"; payload: string }
        | { type: "BEGIN_SEARCH" }
        | { type: "FINISHED_SEARCHING"; payload: ResourceProject[] }
        | { type: "ERROR" },
    ) => {
      switch (action.type) {
        case "SEARCH":
          return { ...state, loading: true, searchTerm: action.payload };

        case "BEGIN_SEARCH":
          return { ...state, loading: true };

        case "ERROR":
          return { ...state, loading: false, results: [] };

        case "FINISHED_SEARCHING":
          return { ...state, loading: false, results: action.payload };
      }
    },
    { loading: true, results: [], searchTerm: "" },
  );

  const searchTermRef = useRef(searchTerm);
  searchTermRef.current = searchTerm;

  useEffect(() => {
    if (!projectLoaded || !canSave) {
      return;
    }

    let controller: AbortController | null = null;

    const doSearch = async () => {
      const term = searchTermRef.current;

      controller?.abort();
      controller = new AbortController();

      try {
        dispatch({ type: "BEGIN_SEARCH" });
        const searchResults = await searchResourceProjects(
          term,
          controller.signal,
        );

        if (!controller.signal.aborted) {
          dispatch({ type: "FINISHED_SEARCHING", payload: searchResults });
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Could not fetch resources", err);
          dispatch({ type: "ERROR" });
        }
      }
    };

    doSearch();

    return () => {
      controller?.abort();
    };
  }, [projectLoaded, canSave, searchTerm, latestReleaseTag]);

  return {
    onChange: (term: string) => dispatch({ type: "SEARCH", payload: term }),
    loading,
    results,
    searchTerm,
  };
};
