import React, { FC, useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { useDropzone } from "react-dropzone";
import classNames from "classnames";

import { AppDispatch } from "../../../features/types";
import { BigModal } from "../BigModal";
import { IconAlert, IconSpinner } from "../../Icon";
import { IconUpload } from "../../Icon/Upload";
import { createDataset } from "../../../features/files/slice";

import "./ModalNewDataset.scss";

export const ModalNewDataset: FC<{ onClose: VoidFunction }> = ({ onClose }) => {
  const dispatch = useDispatch<AppDispatch>();

  const [state, setState] = useState<"uploading" | "failed" | "initial">(
    "initial",
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];

      if (!file) {
        throw new Error("Could not find file");
      }

      setState("uploading");

      try {
        await dispatch(createDataset(file));
        onClose();
      } catch (err) {
        console.error("Uploading failed", err);
        setState("failed");
      }
    },
    [onClose, dispatch],
  );

  const uploading = state === "uploading";

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    multiple: false,
    disabled: uploading,
    accept: ".csv, .json",
  });

  const {
    className: rootClassName,
    onClick: rootOnClick,
    ...rootProps
  } = getRootProps();

  return (
    <div
      {...rootProps}
      className={classNames("ModalNewDatasetContainer", rootClassName)}
    >
      <input {...getInputProps()} />
      <BigModal
        onClose={uploading ? undefined : onClose}
        className="ModalNewDataset"
      >
        <div
          className={classNames("ModalNewDataset__Root", {
            "ModalNewDataset__Root--dragging": isDragActive,
            "ModalNewDataset__Root--notDisabled": !uploading,
          })}
          onClick={rootOnClick}
        >
          <div className="ModalNewDataset__Content">
            {uploading ? (
              <IconSpinner size={55} />
            ) : (
              <>
                <IconUpload size={115} />
                <h3>Click here to upload</h3>
                <p>or drop a file on the screen</p>
                {state === "failed" ? (
                  <p className="ModalNewDataset__Errored">
                    <IconAlert size={20} /> Uploading failed. Please try again.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </BigModal>
    </div>
  );
};
