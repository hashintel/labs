import { Reducer } from "react";

interface DataLoaderParserMessage {
  message: string;
}

interface DataLoaderParserData {
  headings?: string[];
  records?: any[][];
  contents?: string;
}

export type DataLoaderParserState = DataLoaderParserData &
  DataLoaderParserMessage;

interface DataLoaderParserActionSuccess {
  type: "success";
  payload: DataLoaderParserData;
}

interface DataLoaderParserActionInvalidUrl {
  type: "invalidUrl";
  payload: { url: string; errorMessage: string };
}

interface DataLoaderParserActionUnparseableValue {
  type: "unparseableValue";
  payload: { pathname: string; errorMessage: string };
}

interface DataLoaderParserActionUnsupportedExtension {
  type: "unsupportedExtension";
  payload: { pathname: string; ext: string };
}

interface DataLoaderParserActionLoadingError {
  type: "loadingError";
  payload: { pathname: string; errorMessage: string };
}

type DataLoaderParserAction =
  | DataLoaderParserActionSuccess
  | DataLoaderParserActionInvalidUrl
  | DataLoaderParserActionUnparseableValue
  | DataLoaderParserActionUnsupportedExtension
  | DataLoaderParserActionLoadingError;

export type DataLoaderParserReducer = Reducer<
  DataLoaderParserState,
  DataLoaderParserAction
>;
