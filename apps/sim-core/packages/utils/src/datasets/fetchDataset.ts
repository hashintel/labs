import { parseCsvAsJson } from "../parsers/parseCsvAsJson";

export enum DatasetFormat {
  Json = "Json",
  JsonInCsv = "JsonInCsv",
  RawCsv = "RawCsv",
}

export const datasetFormat = (
  ext: string,
  rawCsv: boolean | undefined,
): DatasetFormat | null => {
  switch (ext) {
    case ".json":
      return DatasetFormat.Json;

    case ".csv":
      return rawCsv ? DatasetFormat.RawCsv : DatasetFormat.JsonInCsv;

    default:
      return null;
  }
};

export const parseDatasetUrl = (url: string, rawCsv: undefined | boolean) => {
  const pathname = new URL(url).pathname;
  const ext = pathname.substring(pathname.lastIndexOf("."));
  const format = datasetFormat(ext, rawCsv);

  return { pathname, ext, format };
};

export class DatasetRequestError extends Error {
  name = "DatasetRequestError";
}

export async function fetchDataset(
  url: string,
  format: DatasetFormat,
  inPlaceData: string | null,
  signal?: AbortSignal,
): Promise<string | any[][]> {
  let responseText = null;
  if (inPlaceData) {
    responseText = inPlaceData;
  } else {
    const response = await fetch(url, { signal }).catch((err) => {
      console.error(err);
      return null;
    });

    if (!response) {
      throw new DatasetRequestError("Could not fetch dataset");
    }

    if (!response.ok) {
      throw new DatasetRequestError(
        `${response.status}: ${response.statusText}`,
      );
    }

    responseText = await response.text();
  }

  switch (format) {
    case DatasetFormat.Json:
    case DatasetFormat.JsonInCsv:
      const text = responseText;

      try {
        return JSON.parse(text);
      } catch {
        return text;
      }

    case DatasetFormat.RawCsv: {
      const csvText = responseText;

      const jsonStr = await parseCsvAsJson(csvText);
      return JSON.parse(jsonStr);
    }
  }
}
