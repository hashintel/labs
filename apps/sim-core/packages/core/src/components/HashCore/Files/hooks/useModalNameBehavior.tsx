import React, { useRef } from "react";
import { useDispatch } from "react-redux";
import { useModal } from "react-modal-hook";

import { ModalNameBehavior } from "../../../Modal/NameBehavior";
import type { ParsedPath } from "../../../../util/files/types";
import { parse } from "../../../../util/files";
import { trackEvent } from "../../../../features/analytics";
import { useName } from "./useName";

export const useModalNameBehavior = (
  {
    action,
    placeholder,
    onSubmit,
  }: {
    action: string;
    placeholder: string;
    onSubmit: (path: ParsedPath) => void;
  },
  path?: ParsedPath,
  id?: string
) => {
  const dispatch = useDispatch();
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const [
    { name, selectedLanguage },
    { setName, setSelectedLanguage },
    languageOptions,
    [errorMessage, validate],
    reset,
  ] = useName(id, path);

  const [showModal, hideModal] = useModal(() => {
    const done = () => {
      reset();
      hideModal();
    };

    return (
      <ModalNameBehavior
        onSubmit={(evt) => {
          evt.preventDefault();

          if (!validate()) {
            return;
          }

          const path = parse({ name, ext: selectedLanguage.value });
          onSubmitRef.current(path);
          dispatch(
            trackEvent({ action: "New behavior", label: path.formatted })
          );

          done();
        }}
        onCancel={done}
        selectedLanguage={selectedLanguage}
        onSelectedLanguageChange={setSelectedLanguage}
        name={name}
        onNameChange={setName}
        errorMessage={errorMessage}
        languageOptions={languageOptions}
        action={action}
        placeholder={placeholder}
      />
    );
  }, [
    action,
    errorMessage,
    languageOptions,
    name,
    placeholder,
    selectedLanguage,
    setName,
    setSelectedLanguage,
    validate,
    reset,
  ]);

  return showModal;
};
