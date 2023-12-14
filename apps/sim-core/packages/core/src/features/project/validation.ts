import { ErrorOption } from "react-hook-form";
import { validateModelDescription } from "@hashintel/utils/lib/validators/validateModelDescription";
import { validateModelName } from "@hashintel/utils/lib/validators/validateModelName";
import { validateModelPath } from "@hashintel/utils/lib/validators/validateModelPath";

import { QueryError } from "../../util/api";

export const validateName = (name: string) =>
  validateModelName(name) || validateModelName.allowedCharactersMessage;

export const validatePath = (path: string) =>
  validateModelPath(path) || validateModelPath.allowedCharactersMessage;

export const validateDescription = (description: string) =>
  validateModelDescription(description) ||
  validateModelDescription.allowedCharactersMessage;

const matchError = <T extends Record<string, any>>(
  values: T,
  err: any,
): {
  field: keyof T;
  message: string;
} | null => {
  if (err instanceof QueryError) {
    const code = err.onlyError?.extensions?.code;
    if (Object.prototype.hasOwnProperty.call(values, "name")) {
      switch (code) {
        case "INVALID_NAME":
          return {
            field: "name",
            message: validateModelName.allowedCharactersMessage,
          };
        case "NAME_TAKEN":
          return {
            field: "name",
            message: "A model with this name already exists in this namespace",
          };
      }
    }

    if (Object.prototype.hasOwnProperty.call(values, "path")) {
      switch (code) {
        case "PATH_TAKEN":
          return {
            field: "path",
            message: "A model with this path already exists in this namespace",
          };
        case "PATH_RESERVED":
          return {
            field: "path",
            message: "This path name has been reserved",
          };

        case "INVALID_PATH":
          return {
            field: "path",
            message: validateModelPath.allowedCharactersMessage,
          };
      }
    }
  }

  return null;
};

export const handleQueryCodeErrors = async <T extends Record<string, any>>(
  values: T,
  setError: (field: keyof T, error: ErrorOption) => void,
  handler: () => Promise<void>,
) => {
  try {
    await handler();
  } catch (err) {
    const validationError = matchError(values, err);

    if (validationError) {
      setError(validationError.field, {
        message: validationError.message,
        shouldFocus: true,
        type: "validate",
      });
    } else {
      throw err;
    }
  }
};
