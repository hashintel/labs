/**
 * Facade over the Redux examples slice. Consumers use `useExamples()` instead
 * of `useSelector`. Internally still reads from Redux until all slices are
 * migrated.
 */
import React, { createContext, FC, PropsWithChildren, useContext, useMemo } from "react";
import { useSelector } from "react-redux";

import { PartialSimulationProject } from "../project/types";
import { selectExamples, selectExamplesLoaded } from "./selectors";

export interface ExamplesContextValue {
  examples: PartialSimulationProject[];
  examplesLoaded: boolean;
}

const ExamplesContext = createContext<ExamplesContextValue | null>(null);

export const useExamples = () => {
  const ctx = useContext(ExamplesContext);
  if (!ctx) throw new Error("useExamples must be inside ExamplesProvider");
  return ctx;
};

export const ExamplesProvider: FC<PropsWithChildren> = ({ children }) => {
  const examples = useSelector(selectExamples);
  const examplesLoaded = useSelector(selectExamplesLoaded);

  const value = useMemo<ExamplesContextValue>(
    () => ({ examples, examplesLoaded }),
    [examples, examplesLoaded],
  );

  return (
    <ExamplesContext.Provider value={value}>{children}</ExamplesContext.Provider>
  );
};
