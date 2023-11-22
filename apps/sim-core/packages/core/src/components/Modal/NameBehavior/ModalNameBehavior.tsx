import React, {
  FC,
  FormEventHandler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import classNames from "classnames";

import { Dropdown } from "../../Dropdown";
import { IconAlert } from "../../Icon/Alert";
import { IconKeyboardReturn } from "../../Icon/KeyboardReturn";
import { Modal } from "../Modal";
import type { ReactSelectOption } from "../../Dropdown/types";
import { ResizingInputText } from "../../ResizingInputText";
import { useResizeObserver } from "../../../hooks/useResizeObserver/useResizeObserver";

import "./ModalNameBehavior.css";

interface ModalNameBehaviorProps {
  errorMessage: string | null;
  languageOptions: ReactSelectOption[];
  name: string;
  onNameChange: (name: string) => void;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  selectedLanguage: ReactSelectOption;
  onSelectedLanguageChange: (language: ReactSelectOption) => void;
  action: string;
  placeholder: string;
}

export const ModalNameBehavior: FC<ModalNameBehaviorProps> = ({
  onSubmit,
  onCancel,
  name,
  onNameChange,
  errorMessage,
  languageOptions,
  selectedLanguage,
  onSelectedLanguageChange,
  action,
  placeholder,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const [tooltipError, setTooltipError] = useState(false);

  const tooltipErrorRef = useRef(tooltipError);
  tooltipErrorRef.current = tooltipError;

  useEffect(() => {
    inputRef.current?.focus();
  });

  const resize = useCallback(() => {
    if (tooltipErrorRef.current || !inputRef.current) {
      return;
    }

    const inputRect = inputRef.current.getBoundingClientRect();
    const errorRect = errorRef.current?.getBoundingClientRect();

    setTooltipError(
      inputRect.width + (errorRect?.width ?? 0) > window.innerWidth * 0.7,
    );
  }, []);

  useEffect(() => {
    window.addEventListener("resize", resize);

    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  useLayoutEffect(() => {
    if (tooltipErrorRef.current) {
      setTooltipError(false);
      resize();
    }
  }, [errorMessage, resize]);

  const setErrorObserver = useResizeObserver(resize);

  const setErrorRef = useCallback(
    (node: HTMLDivElement) => {
      errorRef.current = node;
      setErrorObserver(node);
    },
    [setErrorObserver],
  );

  return (
    <Modal
      modalClassName={classNames("ModalNameBehavior", {
        "ModalNameBehavior--error": !!errorMessage,
      })}
      onClose={onCancel}
    >
      <form className="ModalNameBehavior--form" onSubmit={onSubmit}>
        <div
          className="ModalNameBehavior--input__wrapper"
          onClick={() => inputRef.current?.focus()}
        >
          <ResizingInputText
            ref={inputRef}
            className="ModalNameBehavior--input"
            value={name}
            placeholder={placeholder}
            onChange={(evt) => onNameChange(evt.target.value)}
            onResize={resize}
          />
          {errorMessage ? (
            <div
              className={classNames("ModalNameBehavior__error-message", {
                "ModalNameBehavior__error-message--tooltip": tooltipError,
              })}
              title={tooltipError ? errorMessage : undefined}
              ref={setErrorRef}
              onClick={() => inputRef.current?.focus()}
            >
              {tooltipError ? <IconAlert /> : errorMessage}
            </div>
          ) : null}
        </div>
        <Dropdown
          options={languageOptions}
          value={selectedLanguage}
          onChange={onSelectedLanguageChange}
          isClearable={false}
          isMulti={false}
          isSearchable={false}
          dark
        />
        <button className="ModalNameBehavior--submit" type="submit">
          {action}
          <IconKeyboardReturn />
        </button>
      </form>
    </Modal>
  );
};

// // @ts-ignore
// ModalNameBehavior.whyDidYouRender = {
//   customName: "ModalNameBehavior"
// };
