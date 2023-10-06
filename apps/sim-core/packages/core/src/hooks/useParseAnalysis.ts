import { useState } from "react";

import { parseAnalysis } from "../components/Analysis/utils";

export const useParseAnalysis = (analysisString: string | undefined) => {
  const [analysis, setAnalysis] = useState(parseAnalysis(analysisString));

  if (analysisString !== analysis.lastAnalysisString) {
    /**
     * This is equivalent to using getDerivedStateFromProps
     *
     * @see https://reactjs.org/docs/hooks-faq.html#how-do-i-implement-getderivedstatefromprops
     * @see https://blog.isquaredsoftware.com/2020/05/blogged-answers-a-mostly-complete-guide-to-react-rendering-behavior/#render-behavior-edge-cases
     */
    setAnalysis(parseAnalysis(analysisString));
  }
  return [analysis, setAnalysis] as const;
};
