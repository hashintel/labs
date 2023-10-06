import React, { FC } from "react";

import { IconHelpCircleOutline } from "../Icon/HelpCircleOutline";

type HelpParagraphProps = {
  text: string;
};

export const HelpParagraph: FC<HelpParagraphProps> = ({ text }) => (
  <div className="AnalysisViewer__MetricsHelp">
    <div className="AnalysisViewer__MetricsHelp__IconText">
      <IconHelpCircleOutline size={16} /> {text}
    </div>{" "}
    <div>
      <strong>
        <a
          href="https://docs.hash.ai/core/creating-simulations/views/analysis"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the docs
        </a>
      </strong>{" "}
      or{" "}
      <strong>
        <a
          href="https://hash.ai/contact"
          target="_blank"
          rel="noopener noreferrer"
        >
          ask a question
        </a>
      </strong>
    </div>
  </div>
);
