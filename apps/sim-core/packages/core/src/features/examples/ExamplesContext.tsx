import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { PartialSimulationProject } from "../project/types";

export interface ExamplesContextValue {
  examples: PartialSimulationProject[];
  examplesLoaded: boolean;
  setExamples: (examples: PartialSimulationProject[]) => void;
}

const ExamplesContext = createContext<ExamplesContextValue | null>(null);

export const useExamples = () => {
  const ctx = useContext(ExamplesContext);
  if (!ctx) throw new Error("useExamples must be inside ExamplesProvider");
  return ctx;
};

export const ExamplesProvider: FC<PropsWithChildren> = ({ children }) => {
  const [examples, setExamplesState] = useState<PartialSimulationProject[]>([]);
  const [examplesLoaded, setExamplesLoaded] = useState(false);

  const setExamples = useCallback((exs: PartialSimulationProject[]) => {
    setExamplesState(exs);
    setExamplesLoaded(true);
  }, []);

  const value = useMemo<ExamplesContextValue>(
    () => ({ examples, examplesLoaded, setExamples }),
    [examples, examplesLoaded, setExamples],
  );

  return (
    <ExamplesContext.Provider value={value}>{children}</ExamplesContext.Provider>
  );
};
