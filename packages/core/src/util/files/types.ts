import type { Ext } from "./enums";

export interface FilePathParts {
  name: string;
  ext: Ext;
  dir?: string;
  root?: string;
}

export type ParsedPath = Required<FilePathParts> & {
  formatted: string;
  base: string;
};
