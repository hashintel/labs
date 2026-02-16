import {
  PartialSimulationProject,
  SimulationProject,
} from "./project/types";
import { Scope, selectScope } from "./scopes";
import { TourProgress, User } from "../util/api/types";
import {
  beginActionSave,
  canUserEditProjectUpdate,
  projectUpdated,
} from "./actions";
import { bootstrapQuery } from "../util/api/queries";
import { createActionQueue } from "./middleware/queue";
import { createAppAsyncThunk } from "./createAppAsyncThunk";
import { getReleaseMeta } from "../util/api";
import { selectCurrentProject } from "./project/selectors";
import { selectFileActions } from "./files/selectors";

export const bootstrapApp = createAppAsyncThunk<{
  user?: User;
  tourProgress: TourProgress | null;
  scopes: Record<Scope.edit | Scope.mutate, boolean>;
  projects?: PartialSimulationProject[];
  examples: PartialSimulationProject[];
  currentProject: SimulationProject | null;
}>("bootstrapApp", async (_, { getState, dispatch }) => {
  getReleaseMeta().catch(() => {
    console.warn(
      "Failed to get release meta at bootstrap time – must retry later"
    );
  });

  const result = await bootstrapQuery();
  const currentProject = selectCurrentProject(getState());
  if (currentProject) {
    // Local-first: all local projects are editable
    dispatch(
      canUserEditProjectUpdate({
        canUserEdit: true,
        dependencies: [],
      })
    );
  }

  const state = getState();

  return {
    ...result,
    tourProgress: "user" in result ? result.user?.tourProgress ?? null : null,
    // We have to reselect this because it could have been updated
    currentProject: selectCurrentProject(state),
    scopes: {
      [Scope.edit]: selectScope[Scope.edit](state),
      [Scope.mutate]: selectScope[Scope.mutate](state),
    },
  };
});

const saveQueue = createActionQueue("save");

/**
 * @warning You cannot catch errors from save because it is queued.
 */
export const save = () =>
  saveQueue.queue(async (next, getState, dispatch) => {
    try {
      const state = getState();
      const project = selectCurrentProject(state);

      if (!project) {
        throw new Error("Cannot save without a project");
      }

      const actions = selectFileActions(state);
      const canSave = selectScope[Scope.save](state);

      if (!canSave || actions.length === 0) {
        return;
      }

      // Local-first: persist via localStorage middleware; no server save
      dispatch(beginActionSave(actions.map((action) => action.uuid)));
      dispatch(
        projectUpdated({
          updatedAt: new Date().toISOString(),
          actions,
          commit: undefined,
        })
      );
    } finally {
      next();
    }
  });
