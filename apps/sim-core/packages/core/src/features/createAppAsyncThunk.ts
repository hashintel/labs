import { AsyncThunkPayloadCreator, createAsyncThunk } from "@reduxjs/toolkit";

import { AppAsyncThunkArgs } from "./types";

export const createAppAsyncThunk = <
  Returned = void,
  ThunkArg = void,
  ExtraArgs extends { extra?: unknown; rejectValue?: unknown } = {}
>(
  typePrefix: string,
  payloadCreator: AsyncThunkPayloadCreator<
    Returned,
    ThunkArg,
    ExtraArgs & AppAsyncThunkArgs
  >
) =>
  createAsyncThunk<Returned, ThunkArg, AppAsyncThunkArgs>(
    typePrefix,
    payloadCreator,
    {
      serializeError: (x: any): any => x,
    }
  );
