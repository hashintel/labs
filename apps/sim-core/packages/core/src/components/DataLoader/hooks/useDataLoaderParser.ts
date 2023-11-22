import { useEffect, useReducer } from "react";
import {
  DatasetFormat,
  DatasetRequestError,
  fetchDataset,
  parseDatasetUrl,
} from "@hashintel/utils/lib/datasets/fetchDataset";

import type { DataLoaderParserReducer, DataLoaderParserState } from "../types";
import { HcDatasetFile } from "../../../features/files/types";
import { jsonToRows } from "../utils";
import { getErrorMessage } from "../../../features/utils";

export const loadingMessage = "Loading...";
export const successMessage = "Success!";

const dataLoaderParserReducer: DataLoaderParserReducer = (state, action) => {
  switch (action.type) {
    case "success":
      return {
        ...action.payload,
        message: successMessage,
      };
    case "invalidUrl":
      return {
        message: [
          `There was a problem parsing ${action.payload.url}`,
          `Parsing failed with: ${action.payload.errorMessage}`,
        ].join("\n"),
      };
    case "unparseableValue":
      return {
        message: [
          `There was a problem parsing "${action.payload.pathname}"`,
          `The server responded with an unparseable value.`,
          `Parsing failed with: ${action.payload.errorMessage}`,
        ].join("\n"),
      };
    case "unsupportedExtension":
      return {
        message: [
          `There was a problem parsing "${action.payload.pathname}"`,
          `The extension "${action.payload.ext}" is not currently displayable.`,
        ].join("\n"),
      };
    case "loadingError":
      return {
        message: [
          `There was a problem loading "${action.payload.pathname}"`,
          `The server responded with: ${action.payload.errorMessage}`,
        ].join("\n"),
      };
    default:
      return state;
  }
};

export const useDataLoaderParser = (
  url: string,
  file: HcDatasetFile,
): DataLoaderParserState => {
  const [state, dispatch] = useReducer(dataLoaderParserReducer, {
    message: loadingMessage,
  });
  const { rawCsv } = file.data;

  useEffect(() => {
    let pathname: string;
    let format: DatasetFormat;

    try {
      const result = parseDatasetUrl(url, rawCsv);

      if (result.format === null) {
        dispatch({
          type: "unsupportedExtension",
          payload: {
            pathname: result.pathname,
            ext: result.ext,
          },
        });
        return;
      }

      ({ pathname, format } = result);
    } catch (error) {
      dispatch({
        type: "invalidUrl",
        payload: { url, errorMessage: getErrorMessage(error) },
      });
      return;
    }

    const controller = new AbortController();

    fetchDataset(url, format, file.data.inPlaceData, controller.signal)
      .then((result) => {
        if (typeof result === "string") {
          /**
           * fetchDataset only returns string when result is not parseable –
           * but it captures the error. Let's trigger the parse error.
           *
           * @todo make this not necessary
           */
          JSON.parse(result);
        } else {
          dispatch({
            type: "success",
            payload: jsonToRows(result, format),
          });
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          return;
        }

        console.error(err);

        if (err instanceof DatasetRequestError) {
          dispatch({
            type: "loadingError",
            payload: {
              pathname,
              errorMessage: err.message,
            },
          });
        } else {
          dispatch({
            type: "unparseableValue",
            payload: {
              pathname,
              errorMessage: err.message,
            },
          });
        }
      });

    return () => controller.abort();
  }, [rawCsv, url]);

  return state;
};
