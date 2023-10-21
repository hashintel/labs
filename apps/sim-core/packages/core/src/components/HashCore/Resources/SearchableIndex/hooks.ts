import { useReducer } from "react";

import type { ResourceProject } from "../../../../features/project/types";

export const useSearchIndex = (): {
  loading: boolean;
  results: ResourceProject[];
  onChange: (term: string) => void;
  searchTerm: string;
} => {
  // const searchTermSubjectRef = useRef(new Subject<string>());
  // const appDispatch = useDispatch();
  // const store = useStore();

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
        | { type: "ERROR" }
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
    { loading: true, results: [], searchTerm: "" }
  );

  // migration shim
  // useEffect(() => {
  //   const search = async (searchTerm: string, signal: AbortSignal) => {
  //     try {
  //       dispatch({ type: "BEGIN_SEARCH" });

  //       const results = await searchResourceProjects(searchTerm, signal);

  //       // Search is triggered on page load - we don't want to track those as events
  //       if (searchTerm) {
  //         appDispatch(
  //           trackEvent({ action: "Index Search: Core", label: searchTerm })
  //         );
  //       }

  //       if (signal.aborted) {
  //         return;
  //       }

  //       dispatch({ type: "FINISHED_SEARCHING", payload: results });
  //     } catch (err) {
  //       if (err.name !== "AbortError") {
  //         console.error("Could not fetch resources", err);

  //         dispatch({ type: "ERROR" });
  //       }
  //     }
  //   };

  //   let controller: AbortController | null = null;

  //   const storeObs = fromStore(store);
  //   const subscription = combineLatest([
  //     merge(
  //       searchTermSubjectRef.current.pipe(skip(1), debounceTime(500)),
  //       searchTermSubjectRef.current.pipe(take(1)),
  //       projectChangeObservable(store).pipe(
  //         withLatestFrom(searchTermSubjectRef.current),
  //         map((pair) => pair[1] ?? "")
  //       ),
  //       storeObs.pipe(
  //         filter(selectProjectLoaded),
  //         map(selectLatestReleaseTag),
  //         distinctUntilChanged(),
  //         withLatestFrom(searchTermSubjectRef.current),
  //         map((pair) => pair[1] ?? "")
  //       )
  //     ),
  //     storeObs.pipe(
  //       filter(selectProjectLoaded),
  //       map(selectScope[Scope.save]),
  //       distinctUntilChanged()
  //     ),
  //   ])
  //     .pipe(debounceTime(0))
  //     .subscribe(([searchTerm, canSave]) => {
  //       controller?.abort();

  //       if (canSave) {
  //         controller = new AbortController();

  //         search(searchTerm, controller.signal).catch((err) => {
  //           if (err.name !== "AbortError") {
  //             console.error(err);
  //           }
  //         });
  //       }
  //     });

  //   return () => {
  //     controller?.abort();
  //     subscription.unsubscribe();
  //   };
  // }, [appDispatch, store]);

  // useEffect(() => {
  //   searchTermSubjectRef.current.next(searchTerm);
  // }, [searchTerm]);

  return {
    onChange: (searchTerm: string) =>
      dispatch({ type: "SEARCH", payload: searchTerm }),
    loading,
    results,
    searchTerm,
  };
};
