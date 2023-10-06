const validatePrivateKey = (field: string) =>
  field.startsWith("__")
    ? "Fields cannot start with a double underscore."
    : null;

export const RESERVED_BUILT_IN_KEYS = [
  "agent_id",
  "agent_name",
  "behaviors",
  "color",
  "direction",
  "velocity",
  "height",
  "hidden",
  "messages",
  "position",
  "position_was_corrected",
  "rgb",
  "scale",
  "search_radius",
  "shape",
  "addMessage",
  "modify",
];

const validateReservedKey = (field: string) =>
  RESERVED_BUILT_IN_KEYS.includes(field)
    ? "Fields should not match a reserved name."
    : null;

const validateCommas = (field: string) =>
  field.includes(",") ? "Fields cannot include commas." : null;

export const validateBehaviorKeyName = (fieldName: string, rootField = true) =>
  [
    validatePrivateKey(fieldName),
    rootField ? validateReservedKey(fieldName) : null,
    validateCommas(fieldName),
  ].filter((error) => !!error);
