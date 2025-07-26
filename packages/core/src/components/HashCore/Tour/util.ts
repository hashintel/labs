import { getOnboardingProject } from "../../../util/api/queries";
import { usePromise } from "../../../hooks/usePromise";

export const getGettingStartedProject = (() => {
  const promise = getOnboardingProject();

  return () => promise;
})();

export const useGettingStartedProject = () =>
  usePromise(getGettingStartedProject);
