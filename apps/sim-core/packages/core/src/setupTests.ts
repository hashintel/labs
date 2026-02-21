// TextEncoder/TextDecoder polyfill for jsdom (Jest 29)
import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder, TextDecoder });

// required to run 'monaco-editor' in the 'jest-dom' environments
// @see https://medium.com/hired-engineering/setting-up-monaco-with-jest-e1e4c963ac
import "jest-canvas-mock";

import { enableMapSet } from "immer";

jest.mock("uuid", () => ({ v4: jest.fn(() => "UUID_V4") }));

jest.mock("./features/toast/ToastContext", () => ({
  useToast: () => ({
    toast: null,
    displayToast: jest.fn(),
    setToastForProject: jest.fn(),
  }),
  ToastProvider: ({ children }: any) => children,
}));

jest.mock("./features/user/UserContext", () => ({
  useUser: () => ({
    isLoggedIn: false,
    bootstrapped: true,
    currentUser: null,
    tourProgress: null,
    userProjects: [],
    userProfileUrl: null,
    userImage: null,
    setBasicUser: jest.fn(),
    addUserProject: jest.fn(),
    updateTourProgress: jest.fn(),
    bootstrapUser: jest.fn(),
  }),
  UserProvider: ({ children }: any) => children,
}));

jest.mock("./features/project/ProjectContext", () => ({
  useProject: () => ({
    currentProject: null,
    currentProjectUrl: null,
    accessGate: null,
    forkCurrentProjectUrl: null,
    setProjectWithMeta: jest.fn(),
    setAccessGate: jest.fn(),
    projectUpdated: jest.fn(),
    canUserEditUpdate: jest.fn(),
  }),
  ProjectProvider: ({ children }: any) => children,
}));

jest.mock("./features/viewer/ViewerContext", () => ({
  useViewer: () => ({
    currentTab: "3d",
    visibleTabs: [],
    editorVisible: true,
    activityVisible: true,
    viewerVisible: true,
    embedded: false,
    userAlerts: [],
    currentProcessChart: "",
    setCurrentTab: jest.fn(),
    toggleEditor: jest.fn(),
    toggleActivity: jest.fn(),
    toggleViewer: jest.fn(),
    onProjectChanged: jest.fn(),
  }),
  ViewerProvider: ({ children }: any) => children,
}));

jest.mock("./features/files/FilesContext", () => {
  const actual = jest.requireActual("./features/files/FilesContext");
  return {
    ...actual,
    useFiles: () => ({
      allFiles: [],
      currentFile: undefined,
      currentFileId: null,
      fileEntities: {},
      openFiles: [],
      openFileIds: [],
      folderTree: [],
      replaceProposal: null,
      pendingDependencies: [],
      fileActions: [],
      didSave: true,
      behaviorKeysVisible: false,
      visualGlobals: false,
      visualAnalysis: false,
      simulationSrc: undefined,
      simulationRequiresPyodide: false,
      parsedAnalysis: null,
      parsedAnalysisMetricNames: [],
      globalsSrc: undefined,
      analysisSrc: undefined,
      experimentsSrc: undefined,
      currentBehavior: undefined,
      behaviorKeysDynamicAccess: false,
      currentFileRepoPath: null,
      descriptionSrc: undefined,
      parsedDependencies: {},
      setCurrentFileId: jest.fn(),
      updateFile: jest.fn(),
      deleteFile: jest.fn(),
      createBehavior: jest.fn(),
      renameBehavior: jest.fn(),
      renameInitFile: jest.fn(),
      closeFile: jest.fn(),
      closeAllFiles: jest.fn(),
      closeOtherFiles: jest.fn(),
      closeFilesToTheRight: jest.fn(),
      forkOpenBehavior: jest.fn(),
      setReplaceProposal: jest.fn(),
      toggleBehaviorKeysEditor: jest.fn(),
      updateBehaviorKeysFile: jest.fn(),
      updateBehaviorKeysDynamicAccess: jest.fn(),
      toggleVisualGlobals: jest.fn(),
      toggleVisualAnalysis: jest.fn(),
      addPreparedFile: jest.fn(),
      createProcessModelFile: jest.fn(),
      handleAddDependencies: jest.fn(),
      handleParseAndShowBehaviorKeys: jest.fn(),
      handleParseAllBehaviorKeys: jest.fn(),
      filesDispatch: jest.fn(),
      filesState: {
        ids: [],
        entities: {},
        openFileIds: [],
        currentFileId: null,
        replaceProposal: null,
        pendingDependencies: [],
        actions: [],
        behaviorKeys: false,
        visualGlobals: false,
        visualAnalysis: false,
      },
    }),
    useFilesSelector: (selector: any) =>
      selector({
        files: { ids: [], entities: {}, openFileIds: [], currentFileId: null },
        viewer: { editor: true },
      }),
  };
});
jest.mock("./features/files/utils", () => {
  const module = jest.requireActual("./features/files/utils");

  return {
    ...module,
    mapFileId: jest.fn(),
  };
});

beforeEach(() => {
  const { mapFileId } = jest.requireActual("./features/files/utils");
  const mock = require("./features/files/utils").mapFileId as jest.Mock;
  mock.mockReset();
  mock.mockImplementation((...args: any[]) => mapFileId(...args));
});

global.BUILD_STAMP = "JEST";

window.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

enableMapSet();

document.queryCommandSupported = () => false;
