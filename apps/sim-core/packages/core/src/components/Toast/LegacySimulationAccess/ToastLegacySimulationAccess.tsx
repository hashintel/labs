import React, { FC, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";

import { SimulationToast } from "../";
import { ToastButton } from "../Button";
import { ToastKind } from "../../../features/toast/enums";
import { displayToast } from "../../../features/toast/slice";
import { selectCurrentProjectUrl } from "../../../features/project/selectors";
import { trackEvent } from "../../../features/analytics";
import { useClipboardWriteText } from "../../../hooks/useClipboardWriteText";

export const ToastLegacySimulationAccess: FC<{ nextToast: ToastKind }> = ({
  nextToast,
}) => {
  const clipboardWriteText = useClipboardWriteText();
  const dispatch = useDispatch();
  const projectUrl = useSelector(selectCurrentProjectUrl);

  const hasTrackedRef = useRef(false);

  useEffect(() => {
    if (!projectUrl || hasTrackedRef.current) {
      return;
    }

    hasTrackedRef.current = true;
    dispatch(
      trackEvent({
        action: "Legacy Simulation URL Accessed",
        label: projectUrl,
      })
    );
  }, [dispatch, projectUrl]);

  return (
    <SimulationToast theme="warning" isDismissable nextToast={nextToast}>
      <span>
        <strong>
          You have used an outdated URL to access this simulation and we
          redirected you to the new URL.
        </strong>{" "}
        Please update your links and bookmarks.
        <ToastButton
          onClick={async (evt) => {
            evt.preventDefault();

            await clipboardWriteText(window.location.href);
            dispatch(displayToast({ kind: nextToast }));
          }}
          icon="copy"
        >
          Copy Link
        </ToastButton>
      </span>
    </SimulationToast>
  );
};
