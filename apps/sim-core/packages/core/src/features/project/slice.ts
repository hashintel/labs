import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import omit from "lodash/omit";
import { navigate } from "hookrouter";

import {
  HashCoreAccessGateKind,
  HashCoreAccessGateKindWithProps,
} from "../../components/HashCore/AccessGate";
import {
  LinkableProject,
  ProjectAccess,
  ProjectSlice,
  ProjectUpdate,
  ReleaseDescription,
  RemoteSimulationProject,
} from "./types";
import { Scope, batchedScopes, selectScope } from "../scopes";
import { ToastKind, displayToast } from "../toast";
import {
  behaviorKeysFileName,
  globalsFileId,
  repoPathForBehavior,
} from "../files/utils";
import {
  canUserEditProjectUpdate,
  projectUpdated,
  setProject,
  setProjectWithMeta,
} from "../actions";
import { createAppAsyncThunk } from "../createAppAsyncThunk";
import { createReleaseWithUpdate } from "../../util/api/queries/createReleaseWithUpdate";
import { forkAndReleaseBehaviors, save } from "../thunks";
import { getLocalStorageProject } from "./utils";
import {
  selectCurrentProjectRequired,
  selectProjectConfig,
  selectProjectPublishedFiles,
} from "./selectors";
import { selectLocalBehaviorFiles } from "../files/selectors";
import { trackEvent } from "../analytics";
import { urlFromProject } from "../../routes";

const projectSliceInitialState: ProjectSlice = {
  projectLoaded: false,
  accessGate: null,
  currentProject: null,
  pendingProject: null,
};

// Migration shim-- unused function, until we get github sync back
// const chooseLatestProject = (
//   remoteProject: SimulationProjectWithHcFiles,
//   localProject: LocalStorageProject | null
// ) => {
//   if (localProject) {
//     const remoteNewer =
//       Date.parse(remoteProject.updatedAt) > Date.parse(localProject.updatedAt);

//     if (remoteNewer) {
//       console.error(
//         [
//           "Changes have been made to this simulation from another device",
//           `localStorage was updated at: ${localProject.updatedAt}`,
//           `server was updated at:       ${remoteProject.updatedAt}`,
//         ].join("\n")
//       );
//       return remoteProject;
//     }

//     return localProject;
//   }

//   return remoteProject;
// };

/**
 * @warning anything fetched in here that depends on a user needs to be
 *          re-fetched in bootstrapApp.
 */
export const fetchProject = createAppAsyncThunk<
  boolean,
  {
    project: LinkableProject;
    fromLegacy?: boolean;
    file?: string;
    access?: ProjectAccess;
    redirect?: boolean;

    // This is useful if you're prefetching – you won't need it in most cases
    prefetchedRemoteProject?: Promise<RemoteSimulationProject>;
  }
>(
  "project/fetchProject",
  async (
    {
      project: { pathWithNamespace, ref },
      fromLegacy = false,
      file,
      redirect = true,
      access, // eslint-disable-line @typescript-eslint/no-unused-vars
      prefetchedRemoteProject, // eslint-disable-line @typescript-eslint/no-unused-vars
    },
    { dispatch, signal, getState }, // eslint-disable-line @typescript-eslint/no-unused-vars
  ) => {
    if (selectScope[Scope.save](getState())) {
      await dispatch(save());
    } else {
      // @todo warn about lost actions
    }

    const refWithDefault = ref ?? "main";

    try {
      // Migration shim
      // To be restored with Github intregration.
      // const remoteProject = prefetchedRemoteProject
      //   ? prepareRemoteProject(await prefetchedRemoteProject, access)
      //   : await projectByPath(
      //       pathWithNamespace,
      //       refWithDefault,
      //       access,
      //       signal
      //     );
      // const localProject = getLocalStorageProject(
      //   pathWithNamespace,
      //   remoteProject.ref
      // );
      // const project = chooseLatestProject(remoteProject, localProject);

      // if (access?.level === "Write" && !project.canUserEdit) {
      //   throw new Error("Invalid access token");
      // }
      const project = getLocalStorageProject(pathWithNamespace, refWithDefault);

      if (!project) {
        const err =
          "Attempted to fetch project from localstorage, but could not.";
        console.warn(err, pathWithNamespace, ref);

        dispatch(
          setAccessGate({
            accessGate: {
              kind: HashCoreAccessGateKind.NotFound,
              props: { requestedProject: null },
            },
            url: pathWithNamespace,
          }),
        );

        return false;
      }

      const scopes = batchedScopes.selectScopes(getState())(project);

      const selectedFile =
        file ?? (scopes[Scope.edit] ? undefined : globalsFileId);

      dispatch(setProjectWithMeta(project, { fromLegacy, file: selectedFile }));
      if (project && redirect) {
        navigate(urlFromProject(project), true, {}, false);
      }

      return true;
    } catch (err) {
      // const requestedProject = { pathWithNamespace, ref: refWithDefault };
      // const gate =
      //   err instanceof QueryError
      //     ? queryErrorToAccessGate(err, {
      //         requestedProject: requestedProject,
      //       })
      //     : null;

      // if (gate) {
      //   dispatch(
      //     setAccessGate({
      //       accessGate: gate,
      //       // @todo include access code in this
      //       url: urlFromProject(requestedProject),
      //     })
      //   );
      //   return false;
      // } else {
      //   throw err;
      // }
      throw err;
    }
  },
);

export const release = createAppAsyncThunk<
  ReleaseDescription,
  {
    tag: string;
    updateDescription: string;
    update?: Omit<ProjectUpdate, "files">;
    toPublish?: string[];
  }
>(
  "project/release",
  async (
    { tag, updateDescription, update = {}, toPublish = [] },
    { dispatch, getState },
  ) => {
    await dispatch(save());

    const state = getState();
    const { pathWithNamespace, type } = selectCurrentProjectRequired(state);
    const currentFiles = selectProjectPublishedFiles(state);
    const config = selectProjectConfig(state);

    if (!config) {
      throw new Error("Cannot release project which has no config");
    }

    const withKeys = Object.fromEntries(
      selectLocalBehaviorFiles(state).flatMap((file) =>
        !file.keys._trackCreation ? [[file.path.base, file]] : [],
      ),
    );

    const newFiles = [...new Set([...currentFiles, ...toPublish])].flatMap(
      (filename) => {
        const path = repoPathForBehavior(filename);
        const file = { filename, path };

        return withKeys[filename]
          ? [
              file,
              {
                filename: behaviorKeysFileName(withKeys[filename]),
                path: repoPathForBehavior(
                  behaviorKeysFileName(withKeys[filename]),
                ),
              },
            ]
          : [file];
      },
    );

    const { updatedAt, ...changes } = await createReleaseWithUpdate(
      pathWithNamespace,
      tag,
      updateDescription,
      {
        ...update,
        files: newFiles,
      },
    );

    // @todo do this with .fulfilled
    dispatch(
      projectUpdated({
        updatedAt,
        update: {
          ...changes,
          config: {
            ...config,
            files: newFiles.map((file) => file.filename),
          },
        },
      }),
    );

    dispatch(
      trackEvent({
        action: "New Release: Core",
        label: `${type} - ${pathWithNamespace} – ${tag}`,
        context: {
          type,
        },
      }),
    );

    dispatch(displayToast({ kind: ToastKind.ReleaseSuccess }));
    setTimeout(() => dispatch(displayToast({ kind: ToastKind.None })), 6_000);

    return { tag, createdAt: updatedAt };
  },
);

export const {
  reducer: projectReducer,
  actions: { setAccessGate },
} = createSlice({
  name: "project",
  initialState: projectSliceInitialState,
  reducers: {
    setAccessGate(
      state,
      action: PayloadAction<{
        accessGate: HashCoreAccessGateKindWithProps;
        url: string | null;
      }>,
    ) {
      state.accessGate = {
        ...action.payload.accessGate,
        /**
         * We have to store the location because we need to know what URL
         * to redirect back to from any potential modals we open on this page.
         * This is because hookrouter cannot tell us where we came from
         *
         * @todo remove this when we remove hookrouter
         */
        url: action.payload.url,
      };
      state.currentProject = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(setProject, (state, action) => {
        state.currentProject = omit(
          action.payload.project,
          "files",
          "dependencies",
          "actions",
        );

        state.projectLoaded = true;
        state.accessGate = null;
        state.pendingProject = null;
      })
      .addCase(projectUpdated, (state, action) => {
        if (!state.currentProject) {
          throw new Error("Cannot update project that does not exist");
        }

        state.currentProject.updatedAt = action.payload.updatedAt;

        if (action.payload.update) {
          Object.assign(state.currentProject, action.payload.update);
        }
      })
      .addCase(canUserEditProjectUpdate, (state, action) => {
        if (!state.currentProject) {
          throw new Error("Cannot update project that does not exist");
        }

        state.currentProject.canUserEdit = action.payload.canUserEdit;
      })
      .addCase(fetchProject.pending, (state, action) => {
        state.projectLoaded = false;
        state.accessGate = null;
        state.pendingProject = action.meta.arg.project;
      })
      .addCase(fetchProject.rejected, (state, { meta, error }) => {
        state.pendingProject = null;

        if (meta.aborted) {
          return;
        }

        throw error;
      })
      .addCase(forkAndReleaseBehaviors.fulfilled, (state, action) => {
        if (!state.currentProject) {
          throw new Error("Cannot update project that does not exist");
        }

        state.currentProject.updatedAt = action.payload.updatedAt;
      });
  },
});
