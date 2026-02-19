import React, { FC, Fragment, useEffect, useMemo } from "react";

import type { HcFile } from "../../../features/files/types";
import { SIM_DOCS_URL } from "../../../util/api/paths";
import type { UserAlertInState } from "../../../features/viewer/types";
import { useFiles } from "../../../features/files/FilesContext";
import { trackEvent } from "../../../features/analytics";

type HashCoreConsoleAlertProps = {
  alert: UserAlertInState;
  files: Record<string, Pick<HcFile, "id" | "path">>;
};

const filesRegex = /((?:(?:[@\/](?:[\w-]+\/)+)|(?:\/))?[\w-]+\.[a-z]+)/i;

/**
 * Convert internal error language into something more widely accessible.
 */
const makeErrorMessageFriendlier = (message: string) =>
  message.replace(/f64/gi, "number");

export const HashCoreConsoleAlert: FC<HashCoreConsoleAlertProps> = ({
  alert,
  files,
}) => {
  const { setCurrentFileId } = useFiles();

  const message = useMemo(
    () =>
      alert.message?.split(filesRegex).map((piece, idx) =>
        files[piece] ? (
          <a
            key={idx}
            href="#"
            onClick={(evt) => {
              evt.preventDefault();

              setCurrentFileId(files[piece].id);
            }}
          >
            {piece}
          </a>
        ) : (
          <Fragment key={idx}>{makeErrorMessageFriendlier(piece)}</Fragment>
        )
      ),
    [files, alert.message, setCurrentFileId]
  );

  const messageIncludesFiles = useMemo(
    () =>
      filesRegex.test(alert.message) &&
      alert.message.split(filesRegex).some((piece) => files[piece]),
    [alert.message, files]
  );

  useEffect(() => {
    trackEvent({
      action: "User Alert",
      label: Object.values(alert).join(" - "),
    });
  }, [alert]);

  return (
    <>
      {alert.type === "complete" ? null : (
        <>
          {alert.context !== "analysis.json"
            ? `${alert.context} simulation`
            : "analysis.json"}
          :{" "}
        </>
      )}
      {message}
      {alert.type !== "complete" &&
        !messageIncludesFiles &&
        !alert.hideLinksToDocs && (
          <>
            <hr />
            Learn more about common errors in our{" "}
            <a href={`${SIM_DOCS_URL}/extra/troubleshooting/error-reference`}>
              docs
            </a>
          </>
        )}
    </>
  );
};
