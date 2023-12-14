import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useSelector } from "react-redux";
import produce, { Draft } from "immer";

import { Ext } from "../../../../util/files/enums";
import type { HcFile } from "../../../../features/files/types";
import { HcFileKind } from "../../../../features/files/enums";
import type { ParsedPath } from "../../../../util/files/types";
import type { ReactSelectOption } from "../../../Dropdown/types";
import { destinationPathInUse, parse } from "../../../../util/files";
import { selectIdKindAndPathFromFiles } from "../../../../features/files/selectors";
import { validateFileName } from "../../../../util/validation";

const extensionMap = {
  ".js": Ext.Js,
  ".py": Ext.Py,
} as const;

type allowedExtensionString = keyof typeof extensionMap;
type allowedExtensionValue = (typeof extensionMap)[allowedExtensionString];
type LanguageOption = ReactSelectOption & {
  value: allowedExtensionValue;
  label: allowedExtensionString;
};

const isAllowedExtensionString = (str: string): str is allowedExtensionString =>
  Object.prototype.hasOwnProperty.call(extensionMap, str);

const isReactOptionAllowable = (
  option: ReactSelectOption,
): option is LanguageOption => languageOptions.includes(option as any);

const languageOptions: LanguageOption[] = Object.entries(extensionMap).map(
  ([label, value]) => ({
    value,
    label: label as allowedExtensionString,
  }),
);

const languageOptionByValue = languageOptions.reduce<any>((acc, option) => {
  acc[option.value] = option;

  return acc;
}, {}) as Record<allowedExtensionString, LanguageOption>;

const getLanguageForLanguageStr = (
  str: string | undefined,
): LanguageOption | void => {
  const lowerCase = str?.toLowerCase();

  if (!(lowerCase && isAllowedExtensionString(lowerCase))) {
    return;
  }

  return languageOptionByValue[lowerCase];
};

interface NameReducerState {
  name: string;
  selectedLanguage: LanguageOption;
}
type SetName = (name: NameReducerState["name"]) => void;
type SetSelectedLanguage = (language: ReactSelectOption) => void;

const nameReducer = produce(
  (
    state: Draft<NameReducerState>,
    action:
      | { type: "setName"; name: string }
      | { type: "setLanguage"; language: LanguageOption }
      | { type: "set"; value: NameReducerState },
  ): NameReducerState | void => {
    switch (action.type) {
      case "setLanguage":
        state.selectedLanguage = action.language;
        break;

      case "setName": {
        const matches = action.name.trim().match(/^(.*?)(\..*)?$/);
        const selectedLanguage = getLanguageForLanguageStr(matches?.[2]);

        if (matches && selectedLanguage) {
          state.name = matches[1];
          state.selectedLanguage = selectedLanguage;
        } else {
          state.name = action.name;
        }
        break;
      }
      case "set":
        return action.value;
    }
  },
);

const validateReservedName = (
  files: Pick<HcFile, "path" | "kind">[],
  name: string,
) => {
  const reservedNames = files
    .filter(
      (file) =>
        file.kind === HcFileKind.Required || file.kind === HcFileKind.Init,
    )
    .map((file) => file.path.name.toLowerCase());

  return reservedNames.includes(name.toLowerCase())
    ? `"${name.toUpperCase()}" IS A RESERVED NAME`
    : null;
};

const validateAlreadyInUse = (
  files: Parameters<typeof destinationPathInUse>[0],
  sourceId: string | undefined,
  destination: ParsedPath,
) =>
  destinationPathInUse(files, sourceId, destination)
    ? `NAME "${destination.formatted}" ALREADY IN USE`
    : null;

type ValidateHook = [string | null, () => boolean];

const useValidate = (args: {
  id?: string;
  value: NameReducerState;
}): ValidateHook => {
  const files = useSelector(selectIdKindAndPathFromFiles);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const argsRef = useRef(args);
  argsRef.current = args;

  const validate = useCallback(() => {
    const { value, id } = argsRef.current;
    const { name, selectedLanguage } = value;

    const error =
      validateFileName(name) ||
      validateReservedName(files, name) ||
      validateAlreadyInUse(
        files,
        id,
        parse({ name, ext: selectedLanguage.value }),
      ) ||
      null;

    setErrorMessage(error);

    return error === null;
  }, [files]);

  useEffect(() => {
    setErrorMessage(null);
  }, [args.value]);

  return [errorMessage, validate];
};

export const useName = (
  id?: string,
  path?: ParsedPath,
): [
  NameReducerState,
  {
    setName: SetName;
    setSelectedLanguage: SetSelectedLanguage;
  },
  ReactSelectOption[],
  ValidateHook,
  VoidFunction,
] => {
  const defaultValue = path?.name ?? "";
  const defaultLanguage =
    (path?.ext && languageOptions.find((lang) => lang.value === path?.ext)) ??
    languageOptions[0];

  const [currentValue, nameDispatch] = useReducer(nameReducer, {
    name: defaultValue,
    selectedLanguage: defaultLanguage,
  });

  const [errorMessage, validate] = useValidate({ id, value: currentValue });

  const setName = useCallback<SetName>(
    (name) => nameDispatch({ type: "setName", name }),
    [nameDispatch],
  );

  const setSelectedLanguage = useCallback<SetSelectedLanguage>(
    (option) => {
      if (isReactOptionAllowable(option)) {
        nameDispatch({ type: "setLanguage", language: option });
      }
    },
    [nameDispatch],
  );

  const defaultsRef = useRef({ defaultValue, defaultLanguage });
  useEffect(() => {
    defaultsRef.current = { defaultValue, defaultLanguage };
  });

  const reset = useCallback(() => {
    nameDispatch({
      type: "set",
      value: {
        name: defaultsRef.current.defaultValue,
        selectedLanguage: defaultsRef.current.defaultLanguage,
      },
    });
  }, []);

  useEffect(() => {
    setName(defaultValue);
  }, [setName, defaultValue]);

  useEffect(() => {
    setSelectedLanguage(defaultLanguage);
  }, [setSelectedLanguage, defaultLanguage]);

  useEffect(() => {
    if (id || path) {
      validate();
    }
  }, [id, path, validate]);

  return [
    currentValue,
    { setName, setSelectedLanguage },
    languageOptions,
    [errorMessage, validate],
    reset,
  ];
};
