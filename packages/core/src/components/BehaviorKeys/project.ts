import produce from "immer";

import {
  BehaviorKeysDraftFieldWithRows,
  BehaviorKeysDraftRow,
  fieldHasRows,
} from "../../features/files/behaviorKeys";
import { Projection } from "./types";

export const reduceProjection = (
  projection: Projection,
  data: BehaviorKeysDraftFieldWithRows,
): BehaviorKeysDraftFieldWithRows =>
  projection.reduce<BehaviorKeysDraftFieldWithRows>((data, { idx }) => {
    if (!fieldHasRows(data)) {
      throw new Error("Invalid projection");
    }

    const projected = data.rows[idx][1];

    if (!fieldHasRows(projected)) {
      throw new Error("Invalid projection");
    }

    return projected;
  }, data);

export const assignProjection = <T extends BehaviorKeysDraftFieldWithRows>(
  projection: Projection,
  data: T,
  rows: BehaviorKeysDraftRow[],
): T =>
  produce(data, (fullDraft) => {
    const draft = reduceProjection(projection, fullDraft);

    draft.rows = rows;
  });
