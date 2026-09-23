import { useFiles } from "../../../../features/files/FilesContext";
import { useProject } from "../../../../features/project/ProjectContext";
import { useModalNameBehavior } from "./useModalNameBehavior";

export const useNameNewBehaviorModal = () => {
  const { createBehavior } = useFiles();
  const { currentProject } = useProject();

  return useModalNameBehavior({
    action: "Create",
    placeholder: "Name your new file",
    onSubmit(path) {
      if (!currentProject) {
        throw new Error("Cannot create behavior without a project");
      }

      createBehavior({ path, project: currentProject });
    },
  });
};
