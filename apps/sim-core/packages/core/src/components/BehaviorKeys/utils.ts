import { Draft, current } from "immer";

import {
  BehaviorKeysDraftField,
  BehaviorKeysDraftRow,
  BehaviorKeysField,
  toDraftFormat,
  toDraftFormatPerField,
} from "../../features/files/behaviorKeys";
import {
  behaviorKeysRowTemplate,
  behaviorKeysTopLevelRowTemplate,
} from "../../features/files/utils";
import { nextNonClashingName } from "../../util/nextNonClashingName";

export const addField = (
  draft: Draft<BehaviorKeysDraftRow[]>,
  atRoot: boolean
) => {
  const allocatedName = nextNonClashingName("field", [
    "field",
    ...draft.map(([name]) => name),
  ]);

  draft.push(
    toDraftFormatPerField([
      allocatedName,
      atRoot ? behaviorKeysTopLevelRowTemplate : behaviorKeysRowTemplate,
    ])
  );
};

export const castField = (
  draft: Draft<BehaviorKeysDraftField>,
  nextType: BehaviorKeysField["type"]
) => {
  const prevMeta = current(draft.meta);
  const sharedMeta = { nullable: prevMeta.nullable };

  switch (nextType) {
    case "struct":
      if (draft.key !== "fields") {
        Object.assign(draft, {
          key: "fields",
          rows: [],
        });
      }
      draft.meta = {
        ...sharedMeta,
        type: "struct",
      };
      break;

    case "fixed_size_list":
    case "list":
      if (draft.key !== "child") {
        Object.assign(draft, {
          key: "child",
          rows: [toDraftFormatPerField(["child", behaviorKeysRowTemplate])],
        });
      }

      if (nextType === "fixed_size_list") {
        draft.meta = {
          ...sharedMeta,
          type: nextType,
          length: prevMeta.type === "fixed_size_list" ? prevMeta.length : 1,
        };
      } else {
        draft.meta = {
          ...sharedMeta,
          type: nextType,
        };
      }
      break;

    default:
      return {
        ...toDraftFormat({
          ...sharedMeta,
          type: nextType,
        }),
        uuid: draft.uuid,
      };
  }
};
