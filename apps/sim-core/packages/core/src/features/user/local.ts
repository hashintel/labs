import { TourProgress } from "../../util/api/types";
import { getItem, setItem } from "../../hooks/useLocalStorage";

const localTourProgressKey = "hashTour";
export const setLocalTourProgress = (progress: TourProgress) =>
  setItem(localTourProgressKey, progress);
// @todo this should return TourProgress | null
export const getLocalTourProgress = (): TourProgress =>
  getItem<TourProgress>(localTourProgressKey)!;
