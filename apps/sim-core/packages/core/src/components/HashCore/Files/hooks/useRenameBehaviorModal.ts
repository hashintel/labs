import { useDispatch } from "react-redux";

import type { ParsedPath } from "../../../../util/files/types";
import { renameBehavior } from "../../../../features/files/slice";
import { useModalNameBehavior } from "./useModalNameBehavior";

export const useRenameBehaviorModal = (id: string, source: ParsedPath) => {
  const dispatch = useDispatch();

  return useModalNameBehavior(
    {
      action: "Rename",
      placeholder: "Rename your file",
      onSubmit(path) {
        dispatch(
          renameBehavior({
            id,
            newName: path.base,
          })
        );
      },
    },
    source,
    id
  );
};
