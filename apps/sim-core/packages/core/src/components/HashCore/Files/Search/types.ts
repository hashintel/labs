import { Range, editor } from "monaco-editor";

import type { HcFile } from "../../../../features/files/types";

export type SearchQuery = {
  searchTerm: string;
  replacing: boolean;
  replaceTerm: string;
  caseSensitive: boolean;
  regex: boolean;
  preserveCase: boolean;
};

export type Replacement = { range: Range; replaceTerm: string };

export type SearchMatch = Replacement & {
  id: string;
  beforeText: string;
  matchedText: string;
  afterText: string;
};

export type SearchFileResult = {
  file: HcFile;
  model: editor.ITextModel;
  matches: SearchMatch[];
  replacing: boolean;
};

export type SearchResultsDictionary = {
  [index: string]: SearchFileResult;
};
