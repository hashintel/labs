import { JSONSchema7 } from "json-schema";

export type SharedGlobalsProps = {
  schema?: JSONSchema7 | undefined;
  depth: number;
};
