// import { PartialProjectFragment } from "./partialProjectByPath";
import { PartialSimulationProject } from "../../../features/project/types";
import { preparePartialSimulationProject } from "../../../features/project/utils";
// import { query } from "../query";

export const getOnboardingProject =
  async (): Promise<PartialSimulationProject> => {
    // Migration shim

    // const res = await query<{
    //   specialProjects: UnpreparedPartialSimulationProject[];
    // }>(
    //   `
    //       query GetOnboardingSimulation {
    //         specialProjects(type: Onboarding) {
    //           ...PartialProjectFragment
    //         }
    //       }

    //       ${PartialProjectFragment}
    //     `
    // );
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

    return preparePartialSimulationProject(onBoardingProject);
  };
