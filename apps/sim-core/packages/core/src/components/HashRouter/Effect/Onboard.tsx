import { FC, useEffect } from "react";
import { navigate } from "../../../util/navigation";

import { urlFromProject } from "../../../routes";
import { useGettingStartedProject } from "../../HashCore/Tour/util";

export const HashRouterEffectOnboard: FC<{ step?: string }> = ({ step }) => {
  const gettingStartedProject = useGettingStartedProject();

  useEffect(() => {
    if (gettingStartedProject) {
      navigate(urlFromProject(gettingStartedProject), true, {
        triggerTour: step ?? true,
        fromOnboardingRoute: true,
      });
    }
  }, [gettingStartedProject, step]);

  return null;
};
