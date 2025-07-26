import React, {
  Dispatch,
  FC,
  ReactPortal,
  SetStateAction,
  useEffect,
  useMemo,
} from "react";

import { DataTable } from "../DataTable";
import type { EditorInstance } from "../TabbedEditor/types";
import type { HcDatasetFile } from "../../features/files/types";
import { TabbedEditorPanel } from "../TabbedEditor/Panel";
// TODO: @mysterycommand - figure out how to mock "@hashintel/engine-web"
import { getTextModelRequired } from "../../features/monaco";
import { isValidDataTable, isValidHeadings, isValidRecords } from "./utils";
import { loadingMessage, successMessage, useDataLoaderParser } from "./hooks";
import { useRemSize } from "../../hooks/useRemSize";

// Heights for calculating number of rows
// box-sizing: border-box means we don't need to calculate for those elements
const headingHeightRem = 1.875;
const paginationPaddingRem = 0.75 * 2;
const paginationPx = 26;
const rowHeightRem = 1.2;
const rowBorderPx = 1;

interface DataLoaderProps {
  url: string;
  editorInstance: EditorInstance | undefined;
  manifestId: string | null;
  file: HcDatasetFile;
  setDidFallback: Dispatch<SetStateAction<boolean>>;
  containerHeight?: number;
}

export const DataLoader: FC<DataLoaderProps> = ({
  url,
  editorInstance,
  manifestId,
  file,
  setDidFallback,
  containerHeight,
}) => {
  const [remSize, remPortal] = useRemSize() as [number, ReactPortal];

  /**
   * grabbing the whole state object here to have a single, "equal by reference"
   * check in the hook below
   */
  const dataLoaderParserState = useDataLoaderParser(url, file);

  useEffect(() => {
    /**
     * we want to fallback if we're *not* loading (fallback while loading would
     * cause a flicker of stale Monaco content), and if have *in*valid headings
     * and records
     */
    const shouldFallback =
      dataLoaderParserState.message === successMessage &&
      !isValidDataTable(
        dataLoaderParserState.headings,
        dataLoaderParserState.records,
      );

    setDidFallback(shouldFallback);
  }, [dataLoaderParserState, setDidFallback]);

  /**
   * destructuring here because we wind up using these interior values in the
   * deciding what to render
   */
  const { headings, records, contents, message } = dataLoaderParserState;
  const model = getTextModelRequired(file, manifestId);

  useEffect(() => {
    if (contents) {
      model.setValue(contents);
    }
  }, [contents, model]);

  const numRows = useMemo(
    () =>
      containerHeight
        ? // divide container height by row height, taking heading height
          // and pagination height into account
          Math.trunc(
            (containerHeight -
              (remSize * (headingHeightRem + paginationPaddingRem) +
                paginationPx)) /
              (remSize * rowHeightRem + rowBorderPx),
          )
        : // No container height? Don't render yet
          undefined,
    [containerHeight, remSize],
  );

  /**
   * if we're still loading bail early, this should probably re-use the
   * loader/spinner that we show in the viewer while Pyodide is loading
   */
  if (message === loadingMessage) {
    return <div className="DataLoader">{message}</div>;
  }

  if (isValidHeadings(headings) && isValidRecords(records)) {
    return (
      <>
        <DataTable
          headings={headings}
          records={records}
          recordsPerPage={numRows}
        />
        {remPortal}
      </>
    );
  }

  /**
   * no `headings` and `records`, but we do have `contents`? fall back to Monaco
   */
  if (contents) {
    return (
      <TabbedEditorPanel editorInstance={editorInstance} textModel={model} />
    );
  }

  /**
   * at this point `message` represents some kind of an error message
   */
  return <div className="DataLoader">{message}</div>;
};
