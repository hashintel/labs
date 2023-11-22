import { Range, editor } from "monaco-editor";

import type { HcFile } from "../../../../features/files/types";

export interface SearchQuery {
  searchTerm: string;
  replacing: boolean;
  replaceTerm: string;
  caseSensitive: boolean;
  regex: boolean;
  preserveCase: boolean;
}

export interface Replacement {
  range: Range;
  replaceTerm: string;
}

export type SearchMatch = Replacement & {
  id: string;
  beforeText: string;
  matchedText: string;
  afterText: string;
};

export interface SearchFileResult {
  file: HcFile;
  model: editor.ITextModel;
  matches: SearchMatch[];
  replacing: boolean;
}

export type SearchResultsDictionary = Record<string, SearchFileResult>;
