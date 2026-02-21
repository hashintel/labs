import { PartialSimulationProject } from "../../../features/project/types";
import { preparePartialSimulationProject } from "../../../features/project/utils";

export const getOnboardingProject =
  async (): Promise<PartialSimulationProject> => {
    const onBoardingProject = {
      pathWithNamespace: "@hash/wildfires-regrowth",
      name: "Wildfires - Regrowth",
      updatedAt: "2022-05-19T13:57:26.000Z",
      type: "Simulation",
      visibility: "public",
      latestRelease: {
        createdAt: "2022-02-18T15:53:24.422Z",
        tag: "9.9.0",
      },
      forkOf: null,
    } as any;

    return preparePartialSimulationProject(onBoardingProject!);
  };
