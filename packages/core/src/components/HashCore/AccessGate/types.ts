import { HashCoreAccessGateKind } from "./enums";
import { HashCoreAccessGateNotFoundProps } from "./NotFound";

export interface HashCoreAccessGateKindWithProps {
  kind: HashCoreAccessGateKind.NotFound;
  props: HashCoreAccessGateNotFoundProps;
}
