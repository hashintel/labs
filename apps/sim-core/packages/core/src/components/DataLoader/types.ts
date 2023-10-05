import { Reducer } from "react";

type DataLoaderParserMessage = {
  message: string;
};

type DataLoaderParserData = {
  headings?: string[];
  records?: any[][];
  contents?: string;
};

export type DataLoaderParserState = DataLoaderParserData &
  DataLoaderParserMessage;

type DataLoaderParserActionSuccess = {
  type: "success";
  payload: DataLoaderParserData;
};

type DataLoaderParserActionInvalidUrl = {
  type: "invalidUrl";
  payload: { url: string; errorMessage: string };
};

type DataLoaderParserActionUnparseableValue = {
  type: "unparseableValue";
  payload: { pathname: string; errorMessage: string };
};

type DataLoaderParserActionUnsupportedExtension = {
  type: "unsupportedExtension";
  payload: { pathname: string; ext: string };
};

type DataLoaderParserActionLoadingError = {
  type: "loadingError";
  payload: { pathname: string; errorMessage: string };
};

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
