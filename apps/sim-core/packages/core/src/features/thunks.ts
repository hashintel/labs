import { getReleaseMeta } from "../util/api";
import { bootstrapQuery } from "../util/api/queries";
import { canUserEditProject } from "../util/api/queries/canUserEditProject";
import { forkAndReleaseBehaviorsQuery } from "../util/api/queries/forkAndReleaseBehaviorsQuery";
import { TourProgress, User } from "../util/api/types";
import { beginActionSave, canUserEditProjectUpdate } from "./actions";
import { trackEvent } from "./analytics";
import { createAppAsyncThunk } from "./createAppAsyncThunk";
import { HcFileKind } from "./files/enums";
import { selectFileActions, selectLocalBehaviorFiles } from "./files/selectors";
import { HcBehaviorFile, HcFile, HcSharedBehaviorFile } from "./files/types";
import {
  behaviorKeysFileName,
  mapFileId,
  repoPathForBehavior,
} from "./files/utils";
import { createActionQueue } from "./middleware/queue";
import { selectCurrentProject } from "./project/selectors";
import {
  PartialSimulationProject,
  ProjectVisibility,
  SimulationProject,
} from "./project/types";
import { Scope, selectScope } from "./scopes";
// import { Octokit } from "@octokit/rest";

// const authKey = "github-auth";
// if(!localStorage[authKey]) {
//   localStorage[authKey] = window.prompt("Please provide your GitHub personal access token.\n\n It will be preserved in localstorage and used to read and commit files to your GitHub account.\n\nhttps://github.com/settings/tokens/new");
// }
// const octokit = new Octokit({
//   auth: localStorage[authKey],
// });

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
      "Failed to get release meta at bootstrap time – must retry later",
    );
  });

  const result = await bootstrapQuery();
  const currentProject = selectCurrentProject(getState());
  if (currentProject) {
    dispatch(
      canUserEditProjectUpdate(
        await canUserEditProject(
          currentProject.pathWithNamespace,
          currentProject.ref,
        ),
      ),
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
  saveQueue.queue((next, getState, dispatch) => {
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
        // migration shim -- disable these API requests until they can talk to github.

        // const { data } = await octokit.request("/user");
        // console.log("github data:", data);
        //
        // const { result: updatedAt, commit } = await commitActions(
        //   project.pathWithNamespace,
        //   actions,
        //   false,
        //   project.access?.code
        // );

        // dispatch(projectUpdated({ updatedAt, actions, commit }));
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
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
      ]),
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
        result.behaviorRef,
      );

      const forkedBehavior = result.files.find(
        (file): file is HcSharedBehaviorFile =>
          file.id === forkedBehaviorId &&
          file.kind === HcFileKind.SharedBehavior,
      );

      if (!forkedBehavior) {
        throw new Error("Could not find forked behavior");
      }

      return forkedBehavior;
    });

    dispatch(
      // @ts-expect-error redux problems
      trackEvent({
        action: "New Release: Core",
        label: `Behavior - ${forkedBehaviors
          .map((behavior) => behavior.path.formatted)
          .join(", ")} - 1.0.0`,
        context: {
          type: "Behavior",
          forkOf: args.projectPath,
        },
      }),
    );

    return {
      files: result.files,
      updatedAt: result.updatedAt,
      forkedBehaviors,
    };
  },
);
