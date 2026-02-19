import type { ParsedPath } from "../../../../util/files/types";
import { useFiles } from "../../../../features/files/FilesContext";
import { useModalNameBehavior } from "./useModalNameBehavior";

export const useRenameBehaviorModal = (id: string, source: ParsedPath) => {
  const { renameBehavior } = useFiles();

  return useModalNameBehavior(
    {
      action: "Rename",
      placeholder: "Rename your file",
      onSubmit(path) {
        renameBehavior(id, path.base);
      },
    },
    source,
    id
  );
};
