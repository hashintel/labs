import React, { FC, CSSProperties } from "react";

import "./ErrorDetails.css";

interface ErrorDetailsProps {
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  hidden: boolean;
}

const hiddenStyle: CSSProperties = {
  display: "none",
};

export const ErrorDetails: FC<ErrorDetailsProps> = ({
  errorName,
  errorMessage,
  errorStack,
  hidden,
}) => (
  <div className="ErrorDetails" style={hidden ? hiddenStyle : undefined}>
    <strong>Error Details</strong>
    <pre className="ErrorDetails--contents">
      <code>{`\
${errorName}: ${errorMessage}

Stack trace:
${errorStack}

`}</code>
    </pre>
  </div>
);
