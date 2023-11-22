import React, {
  forwardRef,
  HTMLProps,
  ReactNode,
  useEffect,
  MouseEvent,
} from "react";
import classNames from "classnames";

import "./Modal.css";

export interface ModalProps {
  onClose?: () => void;
  modalClassName?: string;
  backdropClassName?: string;
  esc?: boolean;
  backdropExit?: boolean;
  containerClassName?: string;
  children?: ReactNode | null;
  onClick?: HTMLProps<HTMLDivElement>["onClick"];
}

export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      onClose,
      modalClassName = "",
      backdropClassName = "",
      children,
      esc = true,
      backdropExit = true,
      containerClassName,
      onClick,
    },
    ref,
  ) => {
    useEffect(() => {
      if (esc) {
        function handler(evt: KeyboardEvent) {
          if (evt.key === "Escape") {
            evt.preventDefault();
            onClose?.();
          }
        }

        window.addEventListener("keydown", handler);

        return () => {
          window.removeEventListener("keydown", handler);
        };
      }
    }, [esc, onClose]);

    const content = (
      <div
        onClick={(evt) => {
          evt.stopPropagation();
          onClick?.(evt);
        }}
        onMouseDown={(evt) => evt.stopPropagation()}
        className={`Modal ${modalClassName}`}
        ref={ref}
      >
        {children}
      </div>
    );

    return (
      <>
        <div
          className={classNames("Modal-container", containerClassName)}
          onMouseDown={(evt: MouseEvent) => {
            evt.stopPropagation();
            if (backdropExit && evt.button === 0) {
              onClose?.();
            }
          }}
        >
          {content}
        </div>
        <div className={`Modal-backdrop ${backdropClassName}`} />
      </>
    );
  },
);
