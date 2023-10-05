import { HashCoreAccessGateKind } from "./enums";
import { HashCoreAccessGateNotFoundProps } from "./NotFound";

export type HashCoreAccessGateKindWithProps = {
  kind: HashCoreAccessGateKind.NotFound;
  props: HashCoreAccessGateNotFoundProps;
};
