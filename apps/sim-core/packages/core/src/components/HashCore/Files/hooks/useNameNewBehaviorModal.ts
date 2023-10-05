import { useDispatch, useStore } from "react-redux";

import { createBehavior } from "../../../../features/files/slice";
import { selectCurrentProject } from "../../../../features/project/selectors";
import { useModalNameBehavior } from "./useModalNameBehavior";

export const useNameNewBehaviorModal = () => {
  const dispatch = useDispatch();
  const store = useStore();

  return useModalNameBehavior({
    action: "Create",
    placeholder: "Name your new file",
    onSubmit(path) {
      const project = selectCurrentProject(store.getState());

      if (!project) {
        throw new Error("Cannot create behavior without a project");
      }

      dispatch(createBehavior({ path, project }));
    },
  });
};
