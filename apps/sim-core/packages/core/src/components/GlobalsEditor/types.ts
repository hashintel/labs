import { JSONSchema7 } from "json-schema";

export interface SharedGlobalsProps {
  schema?: JSONSchema7 | undefined;
  depth: number;
}
