import type { TourProgress } from "../types";
import { query } from "../query";

export const trackTourProgress = async (progress: TourProgress) =>
  (
    await query<{
      updateMe: {
        id: string;
      };
    }>(
      `
        mutation UpdateTourProgress($completed: Boolean!, $version: String!, $lastStepViewed: String) {
          updateMe(data: { tourProgress: { completed: $completed, version: $version, lastStepViewed: $lastStepViewed }}) {
            id
          }
        }
      `,
      progress
    )
  ).updateMe.id;
