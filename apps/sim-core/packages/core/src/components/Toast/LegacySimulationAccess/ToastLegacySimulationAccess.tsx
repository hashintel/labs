import React, { FC, useEffect, useRef } from "react";

import { SimulationToast } from "../";
import { ToastButton } from "../Button";
import { ToastKind } from "../../../features/toast/enums";
import { trackEvent } from "../../../features/analytics";
import { useClipboardWriteText } from "../../../hooks/useClipboardWriteText";
import { useProject } from "../../../features/project/ProjectContext";
import { useToast } from "../../../features/toast/ToastContext";

export const ToastLegacySimulationAccess: FC<{ nextToast: ToastKind }> = ({
  nextToast,
}) => {
  const clipboardWriteText = useClipboardWriteText();
  const { displayToast } = useToast();
  const { currentProjectUrl: projectUrl } = useProject();

  const hasTrackedRef = useRef(false);

  useEffect(() => {
    if (!projectUrl || hasTrackedRef.current) {
      return;
    }

    hasTrackedRef.current = true;
    trackEvent({
      action: "Legacy Simulation URL Accessed",
      label: projectUrl,
    });
  }, [projectUrl]);

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
            displayToast({ kind: nextToast });
          }}
          icon="copy"
        >
          Copy Link
        </ToastButton>
      </span>
    </SimulationToast>
  );
};
