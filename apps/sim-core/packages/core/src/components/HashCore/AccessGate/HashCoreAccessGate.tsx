import React, { FC, ReactNode } from "react";

import { HashCoreAccessGateKind } from "./enums";
import type { HashCoreAccessGateKindWithProps } from "./types";
import { HashCoreAccessGateNotFound } from "./NotFound";

import "./HashCoreAccessGate.css";

function throwBadGate(gate: HashCoreAccessGateKindWithProps) {
  throw new Error(`Unhandled access gate: ${gate.kind}`);
}

const accessGateToNode = (
  gate: HashCoreAccessGateKindWithProps,
  embedded: boolean
): ReactNode => {
  switch (gate.kind) {
    case HashCoreAccessGateKind.NotFound:
      return <HashCoreAccessGateNotFound embedded={embedded} {...gate.props} />;
    default:
      /**
       * @todo It should be possible for the type system to tell us this at
       *       compile time.
       */
      throwBadGate(gate);
  }
};

export const HashCoreAccessGate: FC<{
  accessGate: HashCoreAccessGateKindWithProps;
  embedded?: boolean;
}> = ({ accessGate, embedded = false }) => (
  <div className="HashCoreAccessGate">
    <div className="HashCoreAccessGate-content">
      {accessGateToNode(accessGate, embedded)}
    </div>
  </div>
);
