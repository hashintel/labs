import React, { FC, useMemo, useState } from "react";

import {
  BehaviorKeysDraftRow,
  DraftBehaviorKeys,
} from "../../features/files/behaviorKeys";
import { BehaviorKeysForm } from "./BehaviorKeysForm";
import { BehaviorKeysProjection } from "./BehaviorKeysProjection";
import { Projection } from "./types";
import { assignProjection, reduceProjection } from "./project";

import "./BehaviorKeys.css";

export const BehaviorKeys: FC<{
  data: DraftBehaviorKeys;
  onChange: (data: DraftBehaviorKeys) => void;
  fileId: string;
  autosuggest: boolean;
  disabled: boolean;
}> = ({ data, onChange, fileId, autosuggest, disabled }) => {
  const [projection, setProjection] = useState<Projection>([]);

  const projectedData = useMemo(() => reduceProjection(projection, data), [
    projection,
    data,
  ]);

  const onProjectedDataChange = (rows: BehaviorKeysDraftRow[]) => {
    if (!disabled) {
      onChange(assignProjection(projection, data, rows));
    }
  };

  const onProjectionChange = (newFieldIdx: number) => {
    setProjection([
      ...projection,
      {
        idx: newFieldIdx,
        label: projectedData.rows[newFieldIdx][0],
      },
    ]);
  };

  return (
    <div className="BehaviorKeys">
      <BehaviorKeysProjection
        projection={projection}
        onProjectionChange={setProjection}
      />
      <BehaviorKeysForm
        data={projectedData}
        onDataChange={onProjectedDataChange}
        onProjectionChange={onProjectionChange}
        projection={projection}
        fileId={fileId}
        autosuggest={autosuggest && projection.length === 0}
        disabled={disabled}
      />
    </div>
  );
};
