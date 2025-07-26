import omit from "lodash/omit";
import { v4 as uuid } from "uuid";

import { HcFileKind } from "./enums";
import { defaultBehaviorKeys } from "./utils";

interface BehaviorKeysFieldShared {
  nullable: boolean;
}

export type BehaviorKeysFieldListShared = BehaviorKeysFieldShared & {
  child: BehaviorKeysField;
};

export type BehaviorKeysFieldScalar = BehaviorKeysFieldShared & {
  type: "number" | "any" | "boolean" | "string";
};

export type BehaviorKeysFieldList = {
  type: "list";
} & BehaviorKeysFieldListShared;

export type BehaviorKeysFieldFixedList = {
  type: "fixed_size_list";
  length: number;
} & BehaviorKeysFieldListShared;

export type BehaviorKeysFieldStruct = {
  type: "struct";
  fields: BehaviorKeyFields;
} & BehaviorKeysFieldShared;

export type BehaviorKeysField =
  | BehaviorKeysFieldScalar
  | BehaviorKeysFieldList
  | BehaviorKeysFieldFixedList
  | BehaviorKeysFieldStruct;

export type BehaviorKeyFields = Record<string, BehaviorKeysField>;

type OmitChildren<Type> = Omit<Type, "child" | "fields">;

export type BehaviorKeysDraftRow<
  KeyType extends BehaviorKeysDraftField = BehaviorKeysDraftField,
> = [string, KeyType];

interface DraftFieldShareProps {
  uuid: string;
}

export type BehaviorKeysDraftFieldScalar = DraftFieldShareProps & {
  meta: OmitChildren<BehaviorKeysFieldScalar>;
  key: "scalar";
};

export type BehaviorKeysDraftFieldList = DraftFieldShareProps & {
  meta: OmitChildren<BehaviorKeysFieldList>;
  key: "child";
  rows: BehaviorKeysDraftRow[];
};

export type BehaviorKeysDraftFieldFixedList = DraftFieldShareProps & {
  meta: OmitChildren<BehaviorKeysFieldFixedList>;
  key: "child";
  rows: BehaviorKeysDraftRow[];
};

export type BehaviorKeysDraftFieldStruct = DraftFieldShareProps & {
  meta: OmitChildren<BehaviorKeysFieldStruct>;
  key: "fields";
  rows: BehaviorKeysDraftRow[];
};

export type DraftBehaviorKeys = BehaviorKeysDraftFieldStruct & {
  version: string;
};

export type BehaviorKeysDraftField =
  | BehaviorKeysDraftFieldScalar
  | BehaviorKeysDraftFieldList
  | BehaviorKeysDraftFieldFixedList
  | BehaviorKeysDraftFieldStruct;

export type BehaviorKeysDraftFieldWithRows =
  | BehaviorKeysDraftFieldList
  | BehaviorKeysDraftFieldFixedList
  | BehaviorKeysDraftFieldStruct;

export interface CommittedBehaviorKeysRoot {
  keys: BehaviorKeyFields;
  built_in_key_use: null | {
    selected: string[];
  };
  dynamic_access: boolean;
  _draft_keys?: DraftBehaviorKeys | null;
}

export type DraftBehaviorKeysRoot = Omit<
  CommittedBehaviorKeysRoot,
  "keys" | "_draft_keys"
> & {
  keys: DraftBehaviorKeys;

  /**
   * This is not saved to the keys file, but is used by the slice to know that
   * if a user attempts to update the behavior keys, it must add a creation
   * action first. This is so that we only create behavior keys files when
   * necessary, but also that behavior files always have a keys field (which
   * simplifies some code).
   */
  _trackCreation: boolean;
};

/**
 * This is necessary because draft state is version controlled by git
 * and may stick around for a while. If the version in the draft does not match,
 * we should throw it away. You should change this if you're changing the draft
 * format.
 */
export const DRAFT_STATE_VERSION = "2";

export const toDraftFormatPerField = ([key, value]: [
  string,
  BehaviorKeysField,
]): BehaviorKeysDraftRow => [key, toDraftFormat(value)];

// export function toDraftFormat(data: BehaviorKeysFieldList): BehaviorKeysDraftFieldList;
// export function toDraftFormat(data: BehaviorKeysFieldFixedList): BehaviorKeysDraftFieldFixedList;
export function toDraftFormat(
  data: BehaviorKeysFieldScalar,
): BehaviorKeysDraftFieldScalar;
export function toDraftFormat(
  data: BehaviorKeysFieldStruct,
): BehaviorKeysDraftFieldStruct;
export function toDraftFormat(data: BehaviorKeysField): BehaviorKeysDraftField;
export function toDraftFormat(data: BehaviorKeysField): BehaviorKeysDraftField {
  const shared = { uuid: uuid() };

  switch (data.type) {
    case "fixed_size_list": {
      const { child, ...meta } = data;

      return {
        ...shared,
        meta,
        key: "child",
        rows: [toDraftFormatPerField(["child", child])],
      };
    }
    case "list": {
      const { child, ...meta } = data;

      return {
        ...shared,
        meta,
        key: "child",
        rows: [toDraftFormatPerField(["child", child])],
      };
    }
    case "struct": {
      const { fields, ...meta } = data;

      return {
        ...shared,
        meta,
        key: "fields",
        rows: Object.entries(fields).map(toDraftFormatPerField),
      };
    }
    default: {
      return { ...shared, meta: data, key: "scalar" };
    }
  }
}

export const fieldHasRows = (
  field: BehaviorKeysDraftField,
): field is BehaviorKeysDraftFieldWithRows =>
  Object.prototype.hasOwnProperty.call(field, "rows");

// export function toBehaviorKeysFormat(data: BehaviorKeysDraftFieldList): BehaviorKeysFieldList;
// export function toBehaviorKeysFormat(data: BehaviorKeysDraftFieldFixedList): BehaviorKeysFieldFixedList;

export function toBehaviorKeysFormat(
  data: BehaviorKeysDraftFieldStruct,
): BehaviorKeysFieldStruct;

export function toBehaviorKeysFormat(
  data: BehaviorKeysDraftFieldWithRows,
): BehaviorKeysField;

export function toBehaviorKeysFormat(
  data: BehaviorKeysDraftFieldWithRows,
): BehaviorKeysField {
  const { rows, meta } = data;
  const fields = rows
    ? Object.fromEntries(
        rows
          .map(
            ([field, row]) =>
              [
                field.trim(),
                fieldHasRows(row) ? toBehaviorKeysFormat(row) : row.meta,
              ] as const,
          )
          .filter((row) => row[0].length > 0),
      )
    : {};

  return meta.type === "list" || meta.type === "fixed_size_list"
    ? {
        ...meta,
        child: fields.child,
      }
    : {
        ...meta,
        fields: fields,
      };
}

export const toRootDraftFormat = (
  fields: BehaviorKeyFields,
): DraftBehaviorKeys => ({
  ...toDraftFormat({
    fields,
    nullable: false,
    type: "struct",
  }),
  version: DRAFT_STATE_VERSION,
});

export const parseKeys = (
  keys: string | undefined,
  type: HcFileKind.Behavior | HcFileKind.SharedBehavior,
): DraftBehaviorKeysRoot => {
  if (typeof keys === "string") {
    // @todo add invalid JSON handling
    // @todo don't assume this matches our target schema
    const parsed = JSON.parse(keys) as CommittedBehaviorKeysRoot;

    return {
      ...omit(parsed, "_draft_keys"),
      keys:
        type === HcFileKind.Behavior &&
        parsed._draft_keys &&
        parsed._draft_keys.version === DRAFT_STATE_VERSION
          ? parsed._draft_keys
          : toRootDraftFormat(parsed.keys),
      _trackCreation: false,
    };
  }

  return {
    ...defaultBehaviorKeys,
    _trackCreation: true,
  };
};

export const calculateRowClashes = (
  rows: BehaviorKeysDraftRow[],
): boolean[] => {
  const nameAndIndex = rows.map(([fieldName], idx) => [fieldName, idx]);
  const entries = Object.fromEntries(nameAndIndex);
  const clashes = Object.fromEntries(
    nameAndIndex.filter(([name, idx]) => entries[name] !== idx),
  );

  return rows.map(([name]) => clashes[name] !== undefined);
};

export const recursiveShouldSaveBehaviorKeysDraft = (
  data: BehaviorKeysDraftFieldWithRows,
): boolean =>
  calculateRowClashes(data.rows).includes(true) ||
  data.rows.some(
    (row) =>
      !row[0].trim().length ||
      (row[1].key !== "scalar" && recursiveShouldSaveBehaviorKeysDraft(row[1])),
  );
