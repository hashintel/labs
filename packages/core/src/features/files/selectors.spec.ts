import { Ext } from "../../util/files/enums";
import type {
  FileAction,
  FilesSlice,
  HcBehaviorFile,
  HcFile,
  HcRequiredFile,
  HcSharedBehaviorFile,
  HcSharedDatasetFile,
} from "./types";
import { HcFileKind } from "./enums";
import type { RootState } from "../types";
import { ViewerSlice } from "../viewer/types";
import { globalsFileId, toHcFiles } from "./utils";
import { mockRemoteProject } from "../project/mocks";
import {
  selectAllFiles,
  selectAllFilesLocal,
  selectCurrentFile,
  selectCurrentFileId,
  selectDatasetFiles,
  selectDatasetFilesLocal,
  selectDatasetIds,
  selectDependencies,
  selectDependenciesFile,
  selectDescription,
  selectDescriptionFile,
  selectDidSave,
  selectEditableFiles,
  selectFileActions,
  selectFileById,
  selectFileByIdLocal,
  selectFileEntities,
  selectFileEntitiesLocal,
  selectFileIds,
  selectFileIdsLocal,
  selectFilesSlice,
  selectGlobals,
  selectInitFiles,
  selectLocalBehaviorFiles,
  selectLocalBehaviorIds,
  selectOpenFileIds,
  selectOpenFiles,
  selectParsedDependencies,
  selectPendingDependencies,
  selectReplaceProposal,
  selectRequiredFiles,
  selectRequiredIds,
  selectSharedBehaviorFiles,
  selectSharedBehaviorFilesLocal,
  selectSharedBehaviorIds,
  selectSimulationSrc,
  selectTotalFiles,
  selectTotalFilesLocal,
} from "./selectors";

/**
 * helpers
 */

const initialCharCode = "a".charCodeAt(0);

const toIds = (file: HcFile): string => file.id;
const toEntries = (file: HcFile): [string, HcFile] => [file.id, file];

const createMockFiles = (
  count: number,
  kind: HcFileKind,
  startAt: number,
  getExt: (i: number) => Ext,
): HcFile[] =>
  new Array(count).fill(true).map<HcFile>((_, idx) => {
    const char = String.fromCharCode(initialCharCode + startAt + idx);
    const ext = getExt(idx);

    const partial = {
      id: `${startAt + idx}`,
      path: {
        name: char,
        ext,
        dir: "",
        root: "",
        formatted: `${char}${ext}`,
        base: `${char}${ext}`,
      },
      repoPath: `src/behaviors/${char}${ext}`,
      contents: "",
    };

    if (kind === HcFileKind.SharedBehavior) {
      return {
        ...partial,
        kind,
        name: `${char}${ext}`,
        latestTag: "2.0.0",
        ref: "2.0.0",
      } as HcSharedBehaviorFile;
    } else if (kind === HcFileKind.Behavior) {
      return {
        ...partial,
        kind,
        name: `${char}${ext}`,
      } as HcBehaviorFile;
    } else if (kind === HcFileKind.Dataset) {
      return {
        ...partial,
        kind,
        name: `${char}${ext}`,
      } as HcSharedDatasetFile;
    } else {
      return {
        ...partial,
        kind,
      } as HcRequiredFile;
    }
  });

const mockRequiredFiles = toHcFiles(mockRemoteProject);

const mockPropertiesFile = mockRequiredFiles.find(
  (file) => file.id === globalsFileId,
)!;

const mockBehaviorFiles = createMockFiles(4, HcFileKind.Behavior, 0, (idx) =>
  idx % 2 === 0 ? Ext.Js : Ext.Py,
);

const mockDatasetFiles = createMockFiles(
  4,
  HcFileKind.Dataset,
  mockBehaviorFiles.length,
  (idx) => (idx % 2 === 0 ? Ext.Json : Ext.Csv),
);

const mockSharedBehaviorFiles = createMockFiles(
  4,
  HcFileKind.SharedBehavior,
  mockBehaviorFiles.length + mockDatasetFiles.length,
  (idx) => (idx % 2 === 0 ? Ext.Js : Ext.Py),
);

const mockFiles = [
  ...mockRequiredFiles,
  ...mockBehaviorFiles,
  ...mockDatasetFiles,
  ...mockSharedBehaviorFiles,
];

const mockFilesInitialState: FilesSlice = {
  ids: [],
  entities: {},
  openFileIds: [],
  currentFileId: null,
  pendingDependencies: [],
  actions: [],
  behaviorKeys: false,
  visualGlobals: false,
  visualAnalysis: false,
  replaceProposal: null,
};

const mockFilesStateWithFiles = {
  ...mockFilesInitialState,
  ids: mockFiles.map(toIds),
  entities: Object.fromEntries(mockFiles.map(toEntries)),
  replaceProposal: null,
  actions: [],
};

const mockState = {
  files: mockFilesStateWithFiles,
  viewer: {
    editor: true,
  },
} as unknown as RootState;

const mockStateWithOpenCurrentFile0 = {
  ...mockState,
  files: {
    ...mockFilesInitialState,
    ids: [mockFiles[0].id],
    entities: {
      [mockFiles[0].id]: mockFiles[0],
      properties: mockPropertiesFile,
    },
    openFileIds: [mockFiles[0].id],
    currentFileId: mockFiles[0].id,
  },
};

const mockStateWithOpenFiles012 = {
  ...mockState,
  files: {
    ...mockFilesStateWithFiles,
    openFileIds: [mockFiles[0].id, mockFiles[1].id, mockFiles[2].id],
  },
};

const mockDependenciesContents = JSON.stringify(
  Object.fromEntries(
    (
      [...mockDatasetFiles, ...mockSharedBehaviorFiles] as (
        | HcSharedDatasetFile
        | HcSharedBehaviorFile
      )[]
    ).map((file) => [file.path.formatted, "private"]),
  ),
  null,
  2,
);

const mockStateWithDependencies = {
  ...mockState,
  files: {
    ...mockFilesStateWithFiles,
    entities: {
      ...mockFilesStateWithFiles.entities,
      dependencies: {
        ...mockFilesStateWithFiles.entities.dependencies,
        contents: mockDependenciesContents,
      },
    },
  },
};

/**
 * actual tests
 */

describe("files selectors", () => {
  describe("selectAllFiles", () => {
    it("should select all files", () => {
      expect(selectAllFiles(mockState)).toEqual(mockFiles);
    });
  });

  describe("selectAllFilesLocal", () => {
    it("should select all files local", () => {
      expect(selectAllFilesLocal(mockState.files)).toEqual(mockFiles);
    });
  });

  describe("selectLocalBehaviorFiles", () => {
    it("should select behavior files", () => {
      expect(selectLocalBehaviorFiles(mockState)).toEqual(mockBehaviorFiles);
    });
  });

  describe("selectLocalBehaviorIds", () => {
    it("should select behavior ids", () => {
      expect(selectLocalBehaviorIds(mockState)).toEqual(
        mockBehaviorFiles.map(toIds),
      );
    });
  });

  describe("selectCurrentFile", () => {
    it("should select current file if editor is visible", () => {
      expect(selectCurrentFile(mockStateWithOpenCurrentFile0)).toEqual(
        mockFiles[0],
      );
    });

    it("should select properties file if editor is not visible", () => {
      expect(
        selectCurrentFile({
          ...mockStateWithOpenCurrentFile0,
          viewer: { editor: false } as ViewerSlice,
        }),
      ).toEqual(mockPropertiesFile);
    });
  });

  describe("selectCurrentFileId", () => {
    it("should select current file id if editor is visible", () => {
      expect(selectCurrentFileId(mockStateWithOpenCurrentFile0)).toEqual(
        mockFiles[0].id,
      );
    });

    it("should select properties file id if editor is not visible", () => {
      expect(
        selectCurrentFileId({
          ...mockStateWithOpenCurrentFile0,
          viewer: { editor: false } as ViewerSlice,
        }),
      ).toEqual(mockPropertiesFile.id);
    });
  });

  describe("selectDatasetFiles", () => {
    it("should select dataset files", () => {
      expect(selectDatasetFiles(mockState)).toEqual(mockDatasetFiles);
    });
  });

  describe("selectDatasetFilesLocal", () => {
    it("should select dataset files local", () => {
      expect(selectDatasetFilesLocal(mockState.files)).toEqual(
        mockDatasetFiles,
      );
    });
  });

  describe("selectDatasetIds", () => {
    it("should select dataset ids", () => {
      expect(selectDatasetIds(mockState)).toEqual(mockDatasetFiles.map(toIds));
    });
  });

  describe("selectDependencies", () => {
    it("should select dependencies when there are none", () => {
      expect(selectDependencies(mockState)).toEqual("{}");
    });

    it("should select dependencies when there are some", () => {
      expect(
        JSON.parse(selectDependencies(mockStateWithDependencies) ?? "{}"),
      ).toEqual({
        "e.json": "private",
        "f.csv": "private",
        "g.json": "private",
        "h.csv": "private",
        "i.js": "private",
        "j.py": "private",
        "k.js": "private",
        "l.py": "private",
      });
    });
  });

  describe("selectParsedDependencies", () => {
    it("should select dependencies when there are none", () => {
      expect(selectParsedDependencies(mockState)).toEqual({});
    });

    it("should select dependencies when there are some", () => {
      expect(selectParsedDependencies(mockStateWithDependencies)).toEqual({
        "e.json": "private",
        "f.csv": "private",
        "g.json": "private",
        "h.csv": "private",
        "i.js": "private",
        "j.py": "private",
        "k.js": "private",
        "l.py": "private",
      });
    });
  });

  describe("selectDependenciesFile", () => {
    it("should select dependencies file", () => {
      expect(selectDependenciesFile(mockState)).toEqual({
        id: "dependencies",
        path: {
          name: "dependencies",
          ext: Ext.Json,
          dir: "",
          root: "",
          formatted: "dependencies.json",
          base: "dependencies.json",
        },
        repoPath: "dependencies.json",
        contents: "{}",
        kind: HcFileKind.Required,
      });
    });
  });

  describe("selectDescription", () => {
    it("should select description", () => {
      expect(selectDescription(mockState)).toEqual(`\
This is a new simulation - it's an empty scaffold to build from.

## Create agents for the simulation:

Define initial agents in init.json by adding objects to the array
  Ex. \`\`\`[{“position”:[0,0], “behaviors”: [‘custom.js’’}]\`\`\`
OR convert init.json to a JavaScript or Python file by right clicking on init.json and return an array of agents
Agents will run each of their behaviors on each step of the simulation

## Add behaviors to the agents

Create new behavior files by clicking the new file indicator in the top left panel.
Select python or javascript.
Attach the behaviors to the agent by adding them to the agents behavior array
  Ex. \`\`\`[{“position”:[0,0], “behaviors”: [‘custom.js’’}]\`\`\`
Behaviors can access and modify the agent state
They can allow the agent to view other agents with neighbors: Neighbors = context.neighbors()
Or allow agents to interact by sending messages state.addMessage(...)

## Run the simulation

Click the Play button or the Step Simulation button in the bottom right under the viewer
If you’ve defined a position on the agent, you’ll see the agent appear in the 3d viewer
Click reset to reset the simulation to the initial state.
`);
    });
  });

  describe("selectDescriptionFile", () => {
    it("should select description file", () => {
      expect(selectDescriptionFile(mockState)).toEqual({
        id: "description",
        path: {
          name: "README",
          ext: Ext.Md,
          dir: "",
          root: "",
          formatted: "README.md",
          base: "README.md",
        },
        repoPath: "README.md",
        contents: `\
This is a new simulation - it's an empty scaffold to build from.

## Create agents for the simulation:

Define initial agents in init.json by adding objects to the array
  Ex. \`\`\`[{“position”:[0,0], “behaviors”: [‘custom.js’’}]\`\`\`
OR convert init.json to a JavaScript or Python file by right clicking on init.json and return an array of agents
Agents will run each of their behaviors on each step of the simulation

## Add behaviors to the agents

Create new behavior files by clicking the new file indicator in the top left panel.
Select python or javascript.
Attach the behaviors to the agent by adding them to the agents behavior array
  Ex. \`\`\`[{“position”:[0,0], “behaviors”: [‘custom.js’’}]\`\`\`
Behaviors can access and modify the agent state
They can allow the agent to view other agents with neighbors: Neighbors = context.neighbors()
Or allow agents to interact by sending messages state.addMessage(...)

## Run the simulation

Click the Play button or the Step Simulation button in the bottom right under the viewer
If you’ve defined a position on the agent, you’ll see the agent appear in the 3d viewer
Click reset to reset the simulation to the initial state.
`,
        kind: HcFileKind.Required,
      });
    });
  });

  describe("selectEditableFiles", () => {
    it("should select editable files", () => {
      expect(selectEditableFiles(mockState)).toEqual([
        ...mockRequiredFiles,
        ...mockBehaviorFiles,
      ]);
    });
  });

  describe("selectFileById", () => {
    it("should select file by id", () => {
      expect(selectFileById(mockState, mockFiles[0].id)).toEqual({
        contents: `\
This is a new simulation - it's an empty scaffold to build from.

## Create agents for the simulation:

Define initial agents in init.json by adding objects to the array
  Ex. \`\`\`[{“position”:[0,0], “behaviors”: [‘custom.js’’}]\`\`\`
OR convert init.json to a JavaScript or Python file by right clicking on init.json and return an array of agents
Agents will run each of their behaviors on each step of the simulation

## Add behaviors to the agents

Create new behavior files by clicking the new file indicator in the top left panel.
Select python or javascript.
Attach the behaviors to the agent by adding them to the agents behavior array
  Ex. \`\`\`[{“position”:[0,0], “behaviors”: [‘custom.js’’}]\`\`\`
Behaviors can access and modify the agent state
They can allow the agent to view other agents with neighbors: Neighbors = context.neighbors()
Or allow agents to interact by sending messages state.addMessage(...)

## Run the simulation

Click the Play button or the Step Simulation button in the bottom right under the viewer
If you’ve defined a position on the agent, you’ll see the agent appear in the 3d viewer
Click reset to reset the simulation to the initial state.
`,
        id: "description",
        kind: "Required",
        repoPath: "README.md",
        path: {
          base: "README.md",
          dir: "",
          ext: ".md",
          formatted: "README.md",
          name: "README",
          root: "",
        },
      });
    });
  });

  describe("selectFileByIdLocal", () => {
    it("should select file by id local", () => {
      expect(selectFileByIdLocal(mockState.files, mockFiles[5].id)).toEqual({
        contents: "[]",
        id: "initialState",
        kind: "Init",
        repoPath: "src/init.json",
        path: {
          base: "init.json",
          dir: "",
          ext: ".json",
          formatted: "init.json",
          name: "init",
          root: "",
        },
      });
    });
  });

  describe("selectFileEntities, selectFileEntitiesLocal, selectFileIds, selectFileIdsLocal", () => {
    const fileIds = [
      "description",
      "properties",
      "analysis",
      "dependencies",
      "experiments",
      "initialState",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
    ];

    it("should select file entities", () => {
      expect(Object.keys(selectFileEntities(mockState))).toEqual(
        expect.arrayContaining(fileIds),
      );
    });

    it("should select file entities local", () => {
      expect(Object.keys(selectFileEntitiesLocal(mockState.files))).toEqual(
        expect.arrayContaining(fileIds),
      );
    });

    it("should select file ids", () => {
      expect(selectFileIds(mockState)).toEqual(fileIds);
    });

    it("should select file ids local", () => {
      expect(selectFileIdsLocal(mockState.files)).toEqual(fileIds);
    });
  });

  describe("selectFilesSlice", () => {
    it("should select files slice", () => {
      expect(selectFilesSlice(mockState)).toBe(mockState.files);
    });
  });

  describe("selectGlobals", () => {
    it("should select globals", () => {
      expect(selectGlobals(mockState)).toEqual(
        '{"onion":{"hasMany":{"layers":true}},"apple":"macbook","twoLevelsDeep":{"theLastLevel":true}}',
      );
    });
  });

  describe("selectOpenFileIds", () => {
    it("should select no open file ids when there are none", () => {
      expect(selectOpenFileIds(mockState)).toEqual([]);
    });

    it("should select open file ids when there are some if editor is visible", () => {
      expect(selectOpenFileIds(mockStateWithOpenFiles012)).toEqual([
        mockFiles[0].id,
        mockFiles[1].id,
        mockFiles[2].id,
      ]);
    });

    it("should select only properties when there are other open files if editor is not visible", () => {
      expect(
        selectOpenFileIds({
          ...mockStateWithOpenFiles012,
          viewer: { editor: false } as ViewerSlice,
        }),
      ).toEqual(["properties"]);
    });
  });

  describe("selectOpenFiles", () => {
    it("should select no open files when there are none", () => {
      expect(selectOpenFiles(mockState)).toEqual([]);
    });

    it("should select open files when there are some if editor is visible", () => {
      expect(selectOpenFiles(mockStateWithOpenFiles012)).toEqual([
        mockFiles[0],
        mockFiles[1],
        mockFiles[2],
      ]);
    });

    it("should select only properties when there are other open files if editor is not visible", () => {
      expect(
        selectOpenFiles({
          ...mockStateWithOpenFiles012,
          viewer: { editor: false } as ViewerSlice,
        }),
      ).toEqual([mockPropertiesFile]);
    });
  });

  describe("selectRequiredFiles", () => {
    it("should select required files", () => {
      expect(selectRequiredFiles(mockState).map(toIds)).toEqual([
        "description",
        "properties",
        "analysis",
        "dependencies",
        "experiments",
      ]);
    });
  });

  describe("selectRequiredIds", () => {
    it("should select required ids", () => {
      expect(selectRequiredIds(mockState)).toEqual([
        "description",
        "properties",
        "analysis",
        "dependencies",
        "experiments",
      ]);
    });
  });

  describe("selectInitFiles", () => {
    it("should select init files", () => {
      expect(selectInitFiles(mockState).map(toIds)).toEqual(["initialState"]);
    });
  });

  describe("selectSharedBehaviorFiles", () => {
    it("should select shared behavior files", () => {
      expect(selectSharedBehaviorFiles(mockState)).toEqual(
        mockSharedBehaviorFiles,
      );
    });
  });

  describe("selectSharedBehaviorFilesLocal", () => {
    it("should select shared behavior files local", () => {
      expect(selectSharedBehaviorFilesLocal(mockState.files)).toEqual(
        mockSharedBehaviorFiles,
      );
    });
  });

  describe("selectSharedBehaviorIds", () => {
    it("should select shared behavior ids", () => {
      expect(selectSharedBehaviorIds(mockState)).toEqual(
        mockSharedBehaviorFiles.map(toIds),
      );
    });
  });

  describe("selectSimulationSrc", () => {
    it("should select simulation src", () => {
      expect(selectSimulationSrc(mockState)).toEqual({
        analysisSrc: `\
{
  "outputs": {},
  "plots": []
}
`,
        behaviors: [
          {
            behaviorSrc: "",
            dependencies: [],
            id: "0",
            name: "a.js",
          },
          {
            behaviorSrc: "",
            dependencies: [],
            id: "1",
            name: "b.py",
          },
          {
            behaviorSrc: "",
            dependencies: [],
            id: "2",
            name: "c.js",
          },
          {
            behaviorSrc: "",
            dependencies: [],
            id: "3",
            name: "d.py",
          },
        ],
        dependenciesSrc: "{}",
        initializers: [
          {
            id: "initialState",
            initSrc: "[]",
            name: "init.json",
          },
        ],
        propertiesSrc:
          '{"onion":{"hasMany":{"layers":true}},"apple":"macbook","twoLevelsDeep":{"theLastLevel":true}}',
        experimentsSrc: "{}",
      });
    });
  });

  describe("selectTotalFiles", () => {
    it("should select total files", () => {
      expect(selectTotalFiles(mockState)).toEqual(mockFiles.length);
    });
  });

  describe("selectTotalFilesLocal", () => {
    it("should select total files local", () => {
      expect(selectTotalFilesLocal(mockState.files)).toEqual(mockFiles.length);
    });
  });

  describe("selectReplaceProposal", () => {
    it("should return null if there is no replace proposal", () => {
      expect(selectReplaceProposal(mockState)).toEqual({
        proposal: null,
        file: null,
      });
    });

    it("should return the replace proposal if editor visible", () => {
      const replaceProposal = {
        fileId: `${mockState.files.ids[0]}`,
        nextContents: "123",
      };
      expect(
        selectReplaceProposal({
          ...mockState,
          files: {
            ...mockState.files,
            replaceProposal,
          },
        }).proposal,
      ).toEqual(replaceProposal);
    });

    it("should not return the replace proposal if editor is not visible", () => {
      const replaceProposal = {
        fileId: `${mockState.files.ids[0]}`,
        nextContents: "123",
      };
      expect(
        selectReplaceProposal({
          ...mockState,
          files: {
            ...mockState.files,
            replaceProposal,
          },
          viewer: { editor: false } as ViewerSlice,
        }).proposal,
      ).toEqual(null);
    });

    it("should return the file if editor is visible", () => {
      expect(
        selectReplaceProposal({
          ...mockState,
          files: {
            ...mockState.files,
            replaceProposal: {
              fileId: `${mockState.files.ids[0]}`,
              nextContents: "123",
            },
          },
        }).file,
      ).toEqual(mockState.files.entities[mockState.files.ids[0]]);
    });

    it("should not return the file if editor is not visible", () => {
      expect(
        selectReplaceProposal({
          ...mockState,
          files: {
            ...mockState.files,
            replaceProposal: {
              fileId: `${mockState.files.ids[0]}`,
              nextContents: "123",
            },
          },
          viewer: { editor: false } as ViewerSlice,
        }).file,
      ).toEqual(null);
    });
  });

  describe("selectPendingDependencies", () => {
    it("should return an empty list when there are no pending dependencies", () => {
      expect(selectPendingDependencies(mockState)).toEqual([]);
    });

    it("should return the list of pending dependencies", () => {
      const pendingDependencies = ["a", "b", "c"];
      expect(
        selectPendingDependencies({
          ...mockState,
          files: {
            ...mockState.files,
            pendingDependencies,
          },
        }),
      ).toEqual(pendingDependencies);
    });
  });

  describe("selectFileActions", () => {
    it("should return the file actions", () => {
      const actions = [1, 2, 3] as any as FileAction[];
      expect(
        selectFileActions({
          ...mockState,
          files: {
            ...mockState.files,
            actions,
          },
        }),
      ).toEqual(actions);
    });
  });

  describe("selectDidSave", () => {
    it("should return true if actions are empty", () => {
      expect(
        selectDidSave({
          ...mockState,
          files: {
            ...mockState.files,
            actions: [],
          },
        }),
      ).toEqual(true);
    });

    it("should return false if actions are not empty", () => {
      expect(
        selectDidSave({
          ...mockState,
          files: {
            ...mockState.files,
            actions: [1] as any as FileAction[],
          },
        }),
      ).toEqual(false);
    });
  });
});
