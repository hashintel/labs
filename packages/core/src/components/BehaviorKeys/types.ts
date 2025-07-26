import { Draft } from "immer";

import { BehaviorKeysDraftField } from "../../features/files/behaviorKeys";

export interface ProjectionItem {
  label: string;
  idx: number;
}

export type Projection = ProjectionItem[];

export interface BehaviorKeysFieldFormProps {
  fieldName: string;
  clash: boolean;
  projection: ProjectionItem[];
  onRowChange: (
    handler: (
      draft: Draft<BehaviorKeysDraftField>,
    ) => void | BehaviorKeysDraftField,
  ) => void;
  onProject: () => void;
  onRemove: () => void;
  onAddField: () => void;
  canModifyFields: boolean;
  canRemoveField: boolean;
  row: BehaviorKeysDraftField;
  onNameChange: (name: string) => void;
  onNameCommit: VoidFunction;
  disabled: boolean;
  typeDisabled: boolean;
  emptyName: boolean;
}
