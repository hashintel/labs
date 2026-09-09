import { Ext } from "./enums";
import type { FilePathParts, ParsedPath } from "./types";

/**
 * @todo can probably generate this
 */
const extByMatch: { [match: string]: Ext } = {
  ".bpmn": Ext.Bpmn,
  ".csv": Ext.Csv,
  ".csv.json": Ext.CsvJson,
  ".js": Ext.Js,
  ".js.json": Ext.JsJson,
  ".json": Ext.Json,
  ".json.json": Ext.JsonJson,
  ".md": Ext.Md,
  ".py": Ext.Py,
  ".py.json": Ext.PyJson,
  ".rs": Ext.Rs,
  ".rs.json": Ext.RsJson,
  ".ts": Ext.Ts,
  ".txt": Ext.Txt,
};

export const extByName: { [name: string]: Ext } = {
  README: Ext.Md,
  init: Ext.Json,
  globals: Ext.Json,
  analysis: Ext.Json,
  dependencies: Ext.Json,
  experiments: Ext.Json,
  loading: Ext.Txt,
};

export const nameByMatch: { [match: string]: string } = {
  description: "README",
  initialState: "init",
  properties: "globals",
};

/**
 * trying to dynamically generate the original:
 * /^(?:([\/@])?(?:([\/\w-]*)\/)?)?([\w-]*)(\.(?:csv|js|json|md|py|rs|ts|txt))?$/
 */
const root = "(?:([\\/@])";
const dir = "(?:([\\/\\w-@]*)\\/)?)";
const name = "([\\w-]*)";
const exts = Object.values(Ext)
  .map((withDot) => withDot.substring(1).replace(".", "\\."))
  .join("|");

const regExp = new RegExp(`^${root}?${dir}?${name}(\\.(?:${exts}))?$`);

export function fromFormatted(formatted: string): Required<FilePathParts> {
  const matches = regExp.exec(formatted);

  if (!matches) {
    throw new Error(`Cannot parse ${formatted}`);
  }

  const root = matches[1] ?? "";
  const dir = matches[2] ?? "";
  const name = nameByMatch[matches[3]] ?? matches[3] ?? "";
  const ext = extByMatch[matches[4]] ?? extByName[name] ?? Ext.Js;

  return {
    root, // either "", "/", or "@" (for local, drive, or index respectively)
    dir, // org/user short name, holds the door open for "folders"
    ext, // one of: ".csv", ".js", ".json", ".md", ".py", ".rs", ".ts", or ".txt"
    name, // whatev.
  };
}

function getParts(file: string | FilePathParts): Required<FilePathParts> {
  if (typeof file === "string") {
    return fromFormatted(file);
  }

  return {
    ...file,
    dir: file.dir ?? "",
    root: file.root ?? "",
  };
}

export function parse(file: string | FilePathParts): ParsedPath {
  const parsed = getParts(file);

  return {
    ...parsed,
    base: `${parsed.name}${extByMatch[parsed.ext]}`,
    formatted: `${parsed.root}${parsed.dir ? `${parsed.dir}/` : ""}${
      parsed.name
    }${parsed.ext}`,
  };
}
