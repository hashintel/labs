import React, { FC } from "react";
import classNames from "classnames";

import { FancyButtonAsyncTask } from "../../Fancy/Button/FancyButtonAsyncTask";
import { useClipboardWriteText } from "../../../hooks/useClipboardWriteText";

import "./ModalShareCopyButton.css";

export const ModalShareCopyButton: FC<{
  text: string | (() => Promise<string>);
  className?: string;
}> = ({ text, className }) => {
  const writeText = useClipboardWriteText();

  return (
    <FancyButtonAsyncTask
      theme="blue"
      className={classNames("ModalShareCopyButton", className)}
      labelClassName="ModalShareCopyButton__Label"
      onTaskBegin={async () => {
        await writeText(typeof text === "function" ? await text() : text);
      }}
      doneText="Copied"
      icon="copy"
    >
      Copy to clipboard
    </FancyButtonAsyncTask>
  );
};
