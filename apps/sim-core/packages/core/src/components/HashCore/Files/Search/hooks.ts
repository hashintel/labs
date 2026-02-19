import { RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { produce } from "immer";
import { IRange, editor } from "monaco-editor";
import { Observable, Subject, merge } from "rxjs";
import {
  buffer,
  distinctUntilChanged,
  filter,
  map,
  pairwise,
} from "rxjs/operators";

import type { HcFile } from "../../../../features/files/types";
import {
  Replacement,
  SearchFileResult,
  SearchQuery,
  SearchResultsDictionary,
} from "./types";
import { SearchDispatch, SearchState } from "./reducer";
import { getDiffModel } from "../../../TabbedEditor/DiffPanel";
import { getNextContents, searchDebounce, triggerSearch } from "./util";
import { isReadOnly } from "../../../../features/files/utils";
import { parseReplaceString } from "./monaco";
import {
  selectFileEntities,
  selectFileIds,
  selectReplaceProposal,
} from "../../../../features/files/selectors";
import { useFiles, useFilesSelector } from "../../../../features/files/FilesContext";
import { useProject } from "../../../../features/project/ProjectContext";
import { setMonacoModel } from "../../../../features/monaco";
import { useMonacoContainerFromContext } from "../../../TabbedEditor/hooks";

const useFileChangeObservable = () => {
  const { allFiles } = useFiles();
  const subject = useMemo(() => new Subject<string[]>(), []);
  const cacheRef = useRef(new Map<string, string>());

  useEffect(() => {
    const cache = cacheRef.current;
    const changedIds: string[] = [];

    const currentIds = new Set(allFiles.map((f) => f.id));
    for (const key of cache.keys()) {
      if (!currentIds.has(key)) {
        cache.delete(key);
      }
    }

    for (const file of allFiles) {
      if (cache.get(file.id) !== file.contents) {
        cache.set(file.id, file.contents);
        changedIds.push(file.id);
      }
    }

    if (changedIds.length > 0) {
      subject.next(changedIds);
    }
  }, [allFiles, subject]);

  return useMemo(
    () => subject.pipe(searchDebounce()),
    [subject],
  );
};

export const useFilesRemovedObservable = () => {
  const { allFiles } = useFiles();
  const fileIds = useMemo(() => allFiles.map((f) => f.id), [allFiles]);
  const subject = useMemo(() => new Subject<string[]>(), []);
  const prevIdsRef = useRef<string[]>(fileIds);

  useEffect(() => {
    const prevIds = prevIdsRef.current;
    prevIdsRef.current = fileIds;

    const removedIds = prevIds.filter((id) => !fileIds.includes(id));
    if (removedIds.length > 0) {
      subject.next(removedIds);
    }
  }, [fileIds, subject]);

  return subject.asObservable();
};

const useQueryChangeObservable = (query: SearchQuery) => {
  const { allFiles } = useFiles();
  const fileIdsRef = useRef<string[]>(allFiles.map((f) => f.id));
  fileIdsRef.current = allFiles.map((f) => f.id);

  const subject = useMemo(() => new Subject<SearchQuery>(), []);

  useEffect(() => {
    subject.next(query);
  }, [subject, query]);

  return useMemo(
    () =>
      subject.pipe(
        searchDebounce(),
        map(() => fileIdsRef.current)
      ),
    [subject]
  );
};

const useRemoveDeletedFilesFromResults = (
  resultsRef: RefObject<SearchResultsDictionary>,
  searchDispatch: SearchDispatch
) => {
  const fileIds = useFilesSelector(selectFileIds);

  useEffect(() => {
    if (!resultsRef.current) {
      return;
    }

    const keysToRemove = Object.keys(resultsRef.current).filter(
      (resultFileId) => !fileIds.includes(resultFileId)
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

  return useMemo(() => merge(fileChangeObservable, queryChangeObservable), [
    fileChangeObservable,
    queryChangeObservable,
  ]);
};

export const useSearch = (
  searchState: SearchState,
  searchDispatch: SearchDispatch
) => {
  const resultsRef = useRef(searchState.resultsMap);
  const queryRef = useRef(searchState.query);

  useEffect(() => {
    resultsRef.current = searchState.resultsMap;
    queryRef.current = searchState.query;
  });

  const { fileEntities } = useFiles();
  const fileEntitiesRef = useRef(fileEntities);
  fileEntitiesRef.current = fileEntities;

  const filesToSearchObserver = useFilesToSearchObserver(searchState);

  const { currentProjectUrl: projectUrl } = useProject();

  useRemoveDeletedFilesFromResults(resultsRef, searchDispatch);

  useEffect(() => {
    if (queryRef.current.searchTerm) {
      searchDispatch({ type: "pending" });
    }
  }, [searchDispatch]);

  useEffect(() => {
    let controller: AbortController | null = null;

    const subscription = (filesToSearchObserver as any).subscribe((filesToSearch: string[]) => {
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

      const files = fileEntitiesRef.current;

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
        controller.signal
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
  }, [filesToSearchObserver, projectUrl, searchDispatch]);
};

/**
 * Highlights the search term in the editor
 */
export const useMonacoSearchHighlightDecorator = (
  results: SearchFileResult[]
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
            }))
          ),
        ] as const
    );

    return () => {
      for (const [model, decorations] of newDecorationsWithModel) {
        if (!model.isDisposed()) {
          model.deltaDecorations(decorations, []);
        }
      }
    };
  }, [results]);
};

export const useReplaceProposal = (
  replacing: boolean,
  results: SearchFileResult[]
) => {
  const { setReplaceProposal } = useFiles();
  const replaceProposal = useFilesSelector(selectReplaceProposal);

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
      ({ file }) => file.id === replacingFileIdRef.current
    );

    if (!resultsForCurrentFile) {
      setReplaceProposal(null);
      return;
    }

    const { file, model, matches } = resultsForCurrentFile;

    if (isReadOnly(file, true)) {
      throw new Error("Found read only file in replaceProposal");
    }

    setReplaceProposal({
      fileId: file.id,
      nextContents: getNextContents(file, model, matches),
    });
  }, [setReplaceProposal, replacing, results]);

  /**
   * This effect removes the visible replace proposal tab when swapping from
   * replace mode to search mode, or when exiting search
   */
  useEffect(() => {
    if (replacing) {
      return () => {
        if (replacingFileIdRef.current) {
          setReplaceProposal(null);
        }
      };
    }
  }, [setReplaceProposal, replacing]);
};

export const useRevealMatchInEditor = () => {
  const { currentProjectUrl: projectUrl } = useProject();
  const [editorInstance] = useMonacoContainerFromContext();
  const [diffEditorInstance] = useMonacoContainerFromContext(true);
  const { setReplaceProposal, setCurrentFileId } = useFiles();

  return useCallback(
    (
      replacing: boolean,
      file: HcFile,
      model: editor.ITextModel,
      matches: Replacement[],
      range?: IRange
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

        setReplaceProposal({ fileId: file.id, nextContents });
        diffEditorInstance.setModel(
          getDiffModel(projectUrl, file, nextContents)
        );

        if (range) {
          diffEditorInstance.revealRangeInCenter(range);
        }
      } else {
        if (!editorInstance) {
          throw new Error("Cannot find editor instance to reveal file in");
        }
        setCurrentFileId(file.id);

        setMonacoModel(editorInstance, model);

        if (range) {
          editorInstance.revealRangeInCenter(range);
        }
      }
    },
    [setReplaceProposal, diffEditorInstance, editorInstance, projectUrl, setCurrentFileId]
  );
};
