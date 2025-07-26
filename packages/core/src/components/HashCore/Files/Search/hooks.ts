import { RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import produce from "immer";
import { IRange, editor } from "monaco-editor";
import { Observable, Subject, merge } from "rxjs";
import {
  buffer,
  distinctUntilChanged,
  filter,
  map,
  pairwise,
} from "rxjs/operators";

import type { AppDispatch, RootState } from "../../../../features/types";
import type { HcFile } from "../../../../features/files/types";
import {
  Replacement,
  SearchFileResult,
  SearchQuery,
  SearchResultsDictionary,
} from "./types";
import { SearchDispatch, SearchState } from "./reducer";
import { fromStore } from "../../../../util/fromStore";
import { getDiffModel } from "../../../TabbedEditor/DiffPanel";
import { getNextContents, searchDebounce, triggerSearch } from "./util";
import { isReadOnly } from "../../../../features/files/utils";
import { parseReplaceString } from "./monaco";
import {
  selectAllFiles,
  selectFileEntities,
  selectFileIds,
  selectReplaceProposal,
} from "../../../../features/files/selectors";
import { selectCurrentProjectUrl } from "../../../../features/project/selectors";
import {
  setCurrentFileId,
  setReplaceProposal,
} from "../../../../features/files/slice";
import { setMonacoModel } from "../../../../features/monaco";
import { useMonacoContainerFromContext } from "../../../TabbedEditor/hooks";

const useFileChangeObservable = () => {
  const store = useStore<RootState>();

  return useMemo(() => {
    const observable = new Observable<string>((subscriber) => {
      const cache = new Map<string, string>();

      const emitChangedFiles = (state: RootState) => {
        const files = selectAllFiles(state);

        for (const file of files) {
          if (cache.get(file.id) !== file.contents) {
            cache.set(file.id, file.contents);

            subscriber.next(file.id);
          }
        }
      };

      const unsubscribeStore = store.subscribe(() => {
        const state = store.getState();
        const ids = selectFileIds(state);

        for (const key of cache.keys()) {
          if (!ids.includes(key)) {
            cache.delete(key);
          }
        }

        emitChangedFiles(state);
      });

      emitChangedFiles(store.getState());

      return () => {
        unsubscribeStore();
      };
    });

    return observable.pipe(buffer(observable.pipe(searchDebounce())));
  }, [store]);
};

export const useFilesRemovedObservable = () => {
  const store = useStore<RootState>();
  return useMemo(() => {
    return fromStore(store).pipe(
      map(selectFileIds),
      distinctUntilChanged(),
      pairwise(),
      map(([firstIds, secondIds]) =>
        firstIds
          .filter((id) => !secondIds.includes(id))
          .map((id) => id.toString()),
      ),
      filter((ids) => ids.length > 0),
    );
  }, [store]);
};

const useQueryChangeObservable = (query: SearchQuery) => {
  const store = useStore<RootState>();
  const subject = useMemo(() => new Subject<SearchQuery>(), []);

  useEffect(() => {
    subject.next(query);
  }, [subject, query]);

  return useMemo(
    () =>
      subject.pipe(
        searchDebounce(),
        map(() => selectFileIds(store.getState()) as string[]),
      ),
    [subject, store],
  );
};

const useRemoveDeletedFilesFromResults = (
  resultsRef: RefObject<SearchResultsDictionary>,
  searchDispatch: SearchDispatch,
) => {
  const fileIds = useSelector(selectFileIds);

  useEffect(() => {
    if (!resultsRef.current) {
      return;
    }

    const keysToRemove = Object.keys(resultsRef.current).filter(
      (resultFileId) => !fileIds.includes(resultFileId),
    );

    if (keysToRemove.length) {
      searchDispatch({
        type: "results",
        payload: produce(resultsRef.current, (draft) => {
          for (const key of keysToRemove) {
            delete draft[key];
          }
        }),
      });
    }
  }, [fileIds, resultsRef, searchDispatch]);
};

const useFilesToSearchObserver = (searchState: SearchState) => {
  const fileChangeObservable = useFileChangeObservable();
  const queryChangeObservable = useQueryChangeObservable(searchState.query);

  return useMemo(
    () => merge(fileChangeObservable, queryChangeObservable),
    [fileChangeObservable, queryChangeObservable],
  );
};

export const useSearch = (
  searchState: SearchState,
  searchDispatch: SearchDispatch,
) => {
  const resultsRef = useRef(searchState.resultsMap);
  const queryRef = useRef(searchState.query);

  useEffect(() => {
    resultsRef.current = searchState.resultsMap;
    queryRef.current = searchState.query;
  });

  const store = useStore<RootState>();
  const filesToSearchObserver = useFilesToSearchObserver(searchState);

  const projectUrl = useSelector(selectCurrentProjectUrl);

  useRemoveDeletedFilesFromResults(resultsRef, searchDispatch);

  useEffect(() => {
    if (queryRef.current.searchTerm) {
      searchDispatch({ type: "pending" });
    }
  }, [searchDispatch]);

  useEffect(() => {
    let controller: AbortController | null = null;

    const subscription = filesToSearchObserver.subscribe((filesToSearch) => {
      controller?.abort();

      const query = queryRef.current;

      /**
       * We don't want to do the search if we don't have a search term, but we
       * didn't filter the event from the observer because we do want to ensure
       * we abort the pending search
       */
      if (!query.searchTerm) {
        controller = null;

        return;
      }

      controller = new AbortController();

      const files = selectFileEntities(store.getState());

      // This parses the replace term for any regex group tokens ($1, $2, etc)
      const pattern = query.replaceTerm
        ? parseReplaceString(query.replaceTerm)
        : null;

      triggerSearch(
        query,
        filesToSearch,
        projectUrl,
        files,
        pattern,
        resultsRef.current,
        controller.signal,
      )
        .then((nextResults) => {
          if (controller!.signal.aborted) {
            throw new Error("Aborted");
          }

          controller = null;
          searchDispatch({
            type: "results",
            payload: nextResults,
          });
        })
        .catch((err) => {
          if (err.message !== "Aborted") {
            throw err;
          }
        });
    });

    return () => {
      controller?.abort();
      subscription.unsubscribe();
    };
  }, [filesToSearchObserver, projectUrl, searchDispatch, store]);
};

/**
 * Highlights the search term in the editor
 */
export const useMonacoSearchHighlightDecorator = (
  results: SearchFileResult[],
) => {
  useEffect(() => {
    if (!results.length) return;

    const newDecorationsWithModel = results.map(
      ({ matches, model }) =>
        [
          model,
          model.deltaDecorations(
            [],
            matches.map(({ range }) => ({
              range,
              options: {
                className: "findMatch",
                isWholeLine: false,
                stickiness:
                  editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              },
            })),
          ),
        ] as const,
    );

    return () => {
      for (const [model, decorations] of newDecorationsWithModel) {
        // It may have been disposed by this point – if we've changed project
        if (!model.isDisposed()) {
          model.deltaDecorations(decorations, []);
        }
      }
    };
  }, [results]);
};

export const useReplaceProposal = (
  replacing: boolean,
  results: SearchFileResult[],
) => {
  const appDispatch = useDispatch<AppDispatch>();
  const replaceProposal = useSelector(selectReplaceProposal);

  const replacingFileId = replaceProposal.proposal?.fileId;
  const replacingFileIdRef = useRef(replacingFileId);

  useEffect(() => {
    replacingFileIdRef.current = replacingFileId;
  });

  /**
   * This effect ensures the nextContents of the replaceProposal stays up to
   * date as files/search results changes
   */
  useEffect(() => {
    if (!replacingFileIdRef.current || !replacing) {
      return;
    }

    const resultsForCurrentFile = results.find(
      ({ file }) => file.id === replacingFileIdRef.current,
    );

    if (!resultsForCurrentFile) {
      appDispatch(setReplaceProposal(null));
      return;
    }

    const { file, model, matches } = resultsForCurrentFile;

    if (isReadOnly(file, true)) {
      throw new Error("Found read only file in replaceProposal");
    }

    appDispatch(
      setReplaceProposal({
        fileId: file.id,
        nextContents: getNextContents(file, model, matches),
      }),
    );
  }, [appDispatch, replacing, results]);

  /**
   * This effect removes the visible replace proposal tab when swapping from
   * replace mode to search mode, or when exiting search
   */
  useEffect(() => {
    if (replacing) {
      return () => {
        if (replacingFileIdRef.current) {
          appDispatch(setReplaceProposal(null));
        }
      };
    }
  }, [appDispatch, replacing]);
};

export const useRevealMatchInEditor = () => {
  const projectUrl = useSelector(selectCurrentProjectUrl);
  const [editorInstance] = useMonacoContainerFromContext();
  const [diffEditorInstance] = useMonacoContainerFromContext(true);
  const appDispatch = useDispatch<AppDispatch>();

  return useCallback(
    (
      replacing: boolean,
      file: HcFile,
      model: editor.ITextModel,
      matches: Replacement[],
      range?: IRange,
    ) => {
      /**
       * We have to manually set the model here because
       * the effect that normally does this for us won't
       * yet have fired, and we need to set the scroll
       * position.
       */
      if (replacing) {
        if (!diffEditorInstance) {
          throw new Error("Cannot find editor instance to reveal file in");
        }
        const nextContents = getNextContents(file, model, matches);

        appDispatch(setReplaceProposal({ fileId: file.id, nextContents }));
        diffEditorInstance.setModel(
          getDiffModel(projectUrl, file, nextContents),
        );

        if (range) {
          diffEditorInstance.revealRangeInCenter(range);
        }
      } else {
        if (!editorInstance) {
          throw new Error("Cannot find editor instance to reveal file in");
        }
        appDispatch(setCurrentFileId(file.id));

        setMonacoModel(editorInstance, model);

        if (range) {
          editorInstance.revealRangeInCenter(range);
        }
      }
    },
    [appDispatch, diffEditorInstance, editorInstance, projectUrl],
  );
};
