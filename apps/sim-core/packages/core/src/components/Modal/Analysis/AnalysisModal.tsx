import React, { FC, FormEventHandler, ReactNode } from "react";
import classNames from "classnames";

import { IconHelpCircleOutline } from "../../Icon/HelpCircleOutline";
import { Modal } from "../Modal";
import { ModalExit } from "../ModalExit";

import "./AnalysisModal.scss";

type AnalysisModalProps = {
  onClose?: () => void;
  cancelButton?: boolean;
  className?: string;
  title: string;
  footerLegend: ReactNode | string | null;
  submitButtonText: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

export const AnalysisModal: FC<AnalysisModalProps> = ({
  onClose,
  cancelButton = true,
  children,
  className,
  title,
  footerLegend,
  submitButtonText,
  onSubmit,
}) => (
  <Modal
    modalClassName={classNames("AnalysisModal-Container", className)}
    onClose={onClose}
  >
    {title ? <h1 className="AnalysisModal__Title">{title}</h1> : null}
    <div className="AnalysisModal">
      {onClose && cancelButton ? <ModalExit onClose={onClose} /> : null}
      <a
        className="AnalysisModal__GetHelp"
        href="https://docs.hash.ai/core/creating-simulations/views/analysis"
        target="_blank"
        rel="noopener noreferrer"
      >
        GET HELP <IconHelpCircleOutline size={13} />
      </a>

      <form autoComplete="off" onSubmit={onSubmit}>
        {children}
        <div className="AnalysisModal__Footer">
          <span>{footerLegend}</span>
          <button className="AnalysisModal__Footer__Button">
            {submitButtonText}
          </button>
        </div>
      </form>
    </div>
  </Modal>
);
