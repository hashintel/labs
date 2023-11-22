import {
  TourShowcase,
  UnpreparedPartialSimulationProject,
} from "../../../features/project/types";
import { preparePartialSimulationProject } from "../../../features/project/utils";

type ApiTourShowcase = UnpreparedPartialSimulationProject & {
  avatar?: string;
  thumbnail?: string;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const getTourShowcase = async (): Promise<TourShowcase[]> =>
  Object.values(
    // await query<{
    //   one: ApiTourShowcase | null;
    //   two: ApiTourShowcase | null;
    //   three: ApiTourShowcase | null;
    // }>(
    //   `
    //     query tourShowcase {
    //       one: project(oldId: "5df7a68cc36ba478454f4a4b", oldType: IndexListing) { ...TourShowcaseFragment }
    //       two: project(oldId: "5ec6e31a68c106c99a6c6836", oldType: IndexListing) { ...TourShowcaseFragment }
    //       three: project(oldId: "5e714a0d182926ef11de9999", oldType: IndexListing) { ...TourShowcaseFragment }
    //     }

    //     fragment TourShowcaseFragment on Project {
    //       avatar
    //       thumbnail
    //       ...PartialProjectFragment
    //     }

    //     ${PartialProjectFragment}
    //   `,
    //   {}
    // )
    // Migration Shim
    tourShowcaseResponse,
  ).reduce<TourShowcase[]>((showcase, item) => {
    if (item) {
      showcase.push({
        ...preparePartialSimulationProject(item),
        avatar: item.avatar,
        thumbnail: item.thumbnail,
      });
    }

    return showcase;
  }, []);

const tourShowcaseResponse: {
  one: ApiTourShowcase | null;
  two: ApiTourShowcase | null;
  three: ApiTourShowcase | null;
} = {
  one: {
    avatar:
      "https://s3.amazonaws.com/images.hash.ai/index/5df7a68cc36ba478454f4a4b.webm",
    thumbnail:
      "https://s3.amazonaws.com/images.hash.ai/index/5df7a68cc36ba478454f4a4b1591460839514.png",
    pathWithNamespace: "@hash/rainfall",
    name: "Rainfall",
    updatedAt: "2022-04-04T15:42:31.315Z",
    type: "Simulation",
    visibility: "public",
    latestRelease: {
      createdAt: "2022-04-04T15:42:31.315Z",
      tag: "7.3.0",
    },
    forkOf: null,
  },
  two: {
    avatar:
      "https://s3.amazonaws.com/images.hash.ai/projects/hash/warehouse-logistics/1604675014939-avatar.mp4",
    thumbnail:
      "https://s3.amazonaws.com/images.hash.ai/projects/projects/hash/warehouse-logistics/1604675019052-thumb.png",
    pathWithNamespace: "@hash/warehouse-logistics",
    name: "Warehouse Logistics",
    updatedAt: "2022-04-04T15:45:40.862Z",
    type: "Simulation",
    visibility: "public",
    latestRelease: {
      createdAt: "2022-04-04T15:45:40.862Z",
      tag: "2.7.0",
    },
    forkOf: null,
  },
  three: {
    avatar:
      "https://s3.amazonaws.com/images.hash.ai/index/5e714a0d182926ef11de9999.webm",
    thumbnail:
      "https://s3.amazonaws.com/images.hash.ai/index/5e714a0d182926ef11de99991591460894388.png",
    pathWithNamespace: "@hash/model-market",
    name: "Model Market",
    updatedAt: "2021-10-28T16:08:40.348Z",
    type: "Simulation",
    visibility: "public",
    latestRelease: {
      createdAt: "2021-10-28T16:08:40.348Z",
      tag: "4.5.2",
    },
    forkOf: null,
  },
};
