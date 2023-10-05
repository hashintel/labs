import { HcBehaviorFile, HcFile, HcSharedBehaviorFile } from "./files/types";
import { HcFileKind } from "./files/enums";
import {
  PartialSimulationProject,
  ProjectVisibility,
  SimulationProject,
} from "./project/types";
import { Scope, selectScope } from "./scopes";
import { TourProgress, User } from "../util/api/types";
import {
  beginActionSave,
  canUserEditProjectUpdate,
  projectUpdated,
} from "./actions";
import {
  behaviorKeysFileName,
  mapFileId,
  repoPathForBehavior,
} from "./files/utils";
import { bootstrapQuery } from "../util/api/queries";
import { canUserEditProject } from "../util/api/queries/canUserEditProject";
import { commitActions } from "../util/api/queries/commitActions";
import { createActionQueue } from "./middleware/queue";
import { createAppAsyncThunk } from "./createAppAsyncThunk";
import { forkAndReleaseBehaviorsQuery } from "../util/api/queries/forkAndReleaseBehaviorsQuery";
import { getReleaseMeta } from "../util/api";
import { selectCurrentProject } from "./project/selectors";
import { selectFileActions, selectLocalBehaviorFiles } from "./files/selectors";
import { trackEvent } from "./analytics";

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
    dispatch(
      canUserEditProjectUpdate(
        await canUserEditProject(
          currentProject.pathWithNamespace,
          currentProject.ref
        )
      )
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

      try {
        dispatch(beginActionSave(actions.map((action) => action.uuid)));
        const { result: updatedAt, commit } = await commitActions(
          project.pathWithNamespace,
          actions,
          false,
          project.access?.code
        );
        dispatch(projectUpdated({ updatedAt, actions, commit }));
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error(err);
          throw err;
        }
      }
    } finally {
      next();
    }
  });

export const forkAndReleaseBehaviors = createAppAsyncThunk<
  {
    files: HcFile[];
    updatedAt: string;
    forkedBehaviors: HcSharedBehaviorFile[];
  },
  {
    projectPath: string;
    name: string;
    namespace: string;
    path: string;
    behaviors: { filename: string; path: string }[];
    projectDescription: string;
    visibility: ProjectVisibility;
    license: string;
    keywords: string[];
    // subjects: string[];
  }
>(
  "forkAndReleaseBehaviors",
  async ({ behaviors, ...args }, { getState, dispatch }) => {
    await dispatch(save());

    const behaviorFiles = selectLocalBehaviorFiles(getState());

    const record = Object.fromEntries(
      behaviorFiles.map((file): [string, HcBehaviorFile] => [
        file.repoPath,
        file,
      ])
    );

    const files = behaviors.flatMap((behavior) => {
      const behaviorFile = record[behavior.path];

      if (!behaviorFile) {
        throw new Error("Cannot release behavior that does not exist");
      }
      return !behaviorFile.keys._trackCreation
        ? [
            behavior,
            {
              filename: behaviorKeysFileName(behaviorFile),
              path: repoPathForBehavior(behaviorKeysFileName(behaviorFile)),
            },
          ]
        : [behavior];
    });

    const result = await forkAndReleaseBehaviorsQuery({
      ...args,
      files,
    });

    const forkedBehaviors = behaviors.map((behavior) => {
      const forkedBehaviorId = mapFileId(
        `${result.behaviorPathWithNamespace}/${behavior.filename}`,
        result.behaviorRef
      );

      const forkedBehavior = result.files.find(
        (file): file is HcSharedBehaviorFile =>
          file.id === forkedBehaviorId &&
          file.kind === HcFileKind.SharedBehavior
      );

      if (!forkedBehavior) {
        throw new Error("Could not find forked behavior");
      }

      return forkedBehavior;
    });

    dispatch(
      trackEvent({
        action: "New Release: Core",
        label: `Behavior - ${forkedBehaviors
          .map((behavior) => behavior.path.formatted)
          .join(", ")} - 1.0.0`,
        context: {
          type: "Behavior",
          forkOf: args.projectPath,
        },
      })
    );

    return {
      files: result.files,
      updatedAt: result.updatedAt,
      forkedBehaviors,
    };
  }
);
