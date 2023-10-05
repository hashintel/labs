/**
 * headings is valid if it's not undefined, and is an array of strings
 */

import { DatasetFormat } from "@hashintel/utils/lib/datasets/fetchDataset";

export const isValidHeadings = (
  headings: string[] | undefined
): headings is string[] =>
  !!(
    headings &&
    Array.isArray(headings) &&
    headings.every((heading) => typeof heading === "string")
  );

/**
 * records is valid is valid if it's not undefined, and is an array, if we
 * really wanted to go nuts with validation here we could also validate each
 * record too:
 *
 * ```
 * records.every(record =>
 *   Array.isArray(record) &&
 *   record.every(cell => typeof cell === 'string')
 * )
 * ```
 */
export const isValidRecords = (
  records: any[][] | undefined
): records is any[][] =>
  !!(records && Array.isArray(records) && Array.isArray(records[0]));

/**
 * we have a valid data table if we have valid `headings` and `records`
 */
export const isValidDataTable = (
  headings: string[] | undefined,
  records: any[][] | undefined
): boolean => isValidHeadings(headings) && isValidRecords(records);

const toDatasetJson = (json: any) => JSON.stringify(json, null, 2);

export const getHeadingsRecordsForJsonObjects = (
  json: any[]
): [string[], any[]] => {
  if (json.length === 0) {
    return [[], []];
  }

  /**
   * `headings` is a `Set` of all the keys of all the objects in the json, the
   * json is presumed to be an array of objects
   */
  const headings = [
    ...json.reduce((acc: Set<string>, record: any) => {
      Object.keys(record).forEach((key) => acc.add(key));
      return acc;
    }, new Set<string>()),
  ];

  /**
   * when a record doesn't have a value for some key/heading (or doesn't have
   * that key at all) we need some kind of fallback
   */
  const defaults = headings.reduce((acc, heading) => {
    acc[heading] = "";
    return acc;
  }, {} as any);

  /**
   * map each object's values into an array whose order matches the headings
   * array, and with a default for nullish values/missing keys
   */
  const records = json.map((record) => {
    return headings.map((heading) => record[heading] ?? defaults[heading]);
  });

  return [headings, records];
};

export const jsonToRows = (json: any[], format: DatasetFormat) => {
  const contents = toDatasetJson(json);

  if (format === DatasetFormat.Json) {
    let headings: string[] | undefined = undefined;
    let records: any[][] | undefined = undefined;

    try {
      if (json.every((row) => typeof row === "object")) {
        const [hs, rs] = getHeadingsRecordsForJsonObjects(json);
        headings = hs;
        records = rs;
      }
    } catch {
      /**
       * if we fail here we have valid json, but it's not an array of
       * objects that we know how to turn in to headings and records,
       * so we want to silently fail this part and "fallback"
       */
    }

    return {
      contents,
      headings,
      records,
    };
  } else {
    const contents = toDatasetJson(json);
    const headings = json.shift();

    return {
      contents,
      headings,
      records: json,
    };
  }
};
