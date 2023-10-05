import { Dictionary } from "@reduxjs/toolkit";
import produce from "immer";
import { Range, editor } from "monaco-editor";
import { debounceTime } from "rxjs/operators";

import type { HcFile } from "../../../../features/files/types";
import { ReplacePattern } from "./monaco";
import {
  Replacement,
  SearchMatch,
  SearchQuery,
  SearchResultsDictionary,
} from "./types";
import { getTextModelRequired } from "../../../../features/monaco";
import { isReadOnly } from "../../../../features/files/utils";
import { yieldToBrowser } from "../../../../util/yieldToBrowser";

const replaceTextInModel = (
  model: editor.ITextModel,
  replacements: Replacement[]
) => {
  model.pushEditOperations(
    [],
    replacements.map(({ range, replaceTerm }) => ({
      range,
      text: replaceTerm,
    })),
    () => []
  );
};

const getNextContentsModel = editor.createModel("");

export const getNextContents = (
  file: HcFile,
  model: editor.ITextModel,
  replacements: Replacement[]
) => {
  getNextContentsModel.setValue(model.getValue());
  replaceTextInModel(getNextContentsModel, replacements);

  const nextContents = getNextContentsModel.getValue();

  getNextContentsModel.setValue("");

  return nextContents;
};

export const replace = async (
  model: editor.ITextModel,
  file: HcFile,
  replacements: { range: Range; replaceTerm: string }[]
) => {
  if (isReadOnly(file, true)) {
    throw new Error("Attempted to trigger replace on a readOnly file");
  }

  replaceTextInModel(model, replacements);
};

export const focusAndSelect = (field: HTMLInputElement | null) => {
  if (field) {
    field.focus();
    field.select();
  }
};

/**
 * This is a function that actually searches all of the monaco models and
 * reports results. Because what it is doing is potentially CPU intensive, it is
 * designed to yield to the browser as frequently as possible, which is why it
 * is an async function. It is also cancellable with a passed signal.
 *
 * It is also incremental, in that it can simply overwrite the results for
 * specified files, rather than searching every file (this is for the case of
 * modifying a file whilst search results are visible).
 */
export const triggerSearch = async (
  query: SearchQuery,
  filesToSearch: string[],
  manifestId: string | null,
  allFiles: Dictionary<HcFile>,
  pattern: ReplacePattern | null,
  prevResults: SearchResultsDictionary,
  signal: AbortSignal
) => {
  let nextResults = prevResults;

  for (const id of filesToSearch) {
    if (signal.aborted) {
      throw new Error("Aborted");
    }

    const file = allFiles[id];

    if (!file) {
      throw new Error(`Cannot search file which does not exist – ${id}`);
    }

    if (query.replacing && isReadOnly(file, true)) {
      nextResults = produce(nextResults, (draft) => {
        delete draft[file.id];
      });
    } else {
      const model = getTextModelRequired(file, manifestId);

      const modelMatches = model.findMatches(
        query.searchTerm,
        false,
        query.regex,
        query.caseSensitive,
        null,
        true
      );

      await yieldToBrowser();

      if (signal.aborted) {
        throw new Error("Aborted");
      }

      const fileMatches: SearchMatch[] = [];

      for (const { matches, range } of modelMatches) {
        if (signal.aborted) {
          throw new Error("Aborted");
        }

        if (matches && matches.length > 0) {
          fileMatches.push({
            id: `${file.path.formatted}(${range.startLineNumber}-${range.startColumn}:${range.endLineNumber}:${range.endColumn}`,
            replaceTerm:
              pattern?.buildReplaceString(matches, query.preserveCase) ?? "",
            beforeText: model.getValueInRange({
              startLineNumber: range.startLineNumber,
              startColumn: model.getLineMinColumn(range.startLineNumber),
              endLineNumber: range.endLineNumber,
              endColumn: range.startColumn,
            }),
            matchedText: model.getValueInRange(range),
            afterText: model.getValueInRange({
              startLineNumber: range.endLineNumber,
              startColumn: range.endColumn,
              endLineNumber: range.endLineNumber,
              endColumn: model.getLineMaxColumn(range.endLineNumber),
            }),
            range,
          });

          await yieldToBrowser();
        }
      }

      nextResults = produce(nextResults, (draft) => {
        draft[id] = {
          file,
          model,
          matches: fileMatches,
          replacing: query.replacing,
        };
      });
    }

    await yieldToBrowser();
  }

  if (signal.aborted) {
    throw new Error("Aborted");
  }

  return nextResults;
};

export const searchDebounce = () => debounceTime(500);
