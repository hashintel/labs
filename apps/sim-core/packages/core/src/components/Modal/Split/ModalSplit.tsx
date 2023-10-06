import React, { FC, forwardRef, ReactNode } from "react";
import classNames from "classnames";

import { IconSpinner } from "../../Icon/Spinner";
import { Modal, ModalProps } from "../Modal";
import { ModalExit } from "../ModalExit";

import "./ModalSplit.scss";

type ModalSplitOuterProps = ModalProps & { loading?: boolean };

type ModalSplitInnerProps = {
  top?: ReactNode | null;
  bottom?: ReactNode | null;
  innerClassName?: string;
};

export const ModalSplitOuter = forwardRef<HTMLDivElement, ModalSplitOuterProps>(
  ({ modalClassName, children, loading, onClose, ...props }, ref) => (
    <Modal
      {...props}
      onClose={onClose}
      ref={ref}
      modalClassName={classNames(
        "ModalSplit",
        {
          "ModalSplit--loading": loading,
        },
        modalClassName
      )}
    >
      {loading ? (
        <IconSpinner />
      ) : (
        <div
          className="ModalSplit__Container"
          onClick={(evt) => {
            evt.stopPropagation();
          }}
        >
          {onClose ? <ModalExit onClose={onClose} /> : null}
          {children}
        </div>
      )}
    </Modal>
  )
);

export const ModalSplitInner: FC<ModalSplitInnerProps> = ({
  top,
  bottom,
  innerClassName,
}) => (
  <div className={innerClassName}>
    {top ? (
      <div
        className={classNames("ModalSplitInner__Top", {
          "ModalSplitInner__Top--noBottom": !bottom,
        })}
      >
        {top}
      </div>
    ) : null}
    {bottom ? <div className="ModalSplitInner__Bottom">{bottom}</div> : null}
  </div>
);

export const ModalSplit: FC<ModalSplitOuterProps & ModalSplitInnerProps> = ({
  top,
  bottom,
  innerClassName,
  ...props
}) => (
  <ModalSplitOuter {...props}>
    <ModalSplitInner
      top={top}
      bottom={bottom}
      innerClassName={innerClassName}
    />
  </ModalSplitOuter>
);
