import produce from "immer";
import { v4 as uuid } from "uuid";

import {
  DependenciesDescriptor,
  FileAction,
  FilesSlice,
  HcBehaviorFile,
  HcFile,
  HcSharedBehaviorFile,
} from "./types";
import { Ext } from "../../util/files/enums";
import { HcFileKind } from "./enums";
import { SimulationProject } from "../project/types";
import {
  addDependencies,
  closeAllFiles,
  closeFile,
  closeFilesToTheRight,
  closeOtherFiles,
  createBehavior,
  deleteFile,
  filesReducer,
  forkOpenBehavior,
  renameBehavior,
  setCurrentFileId,
  setReplaceProposal,
  updateFile,
} from "./slice";
import { defaultBehaviorKeys, mapFileId } from "./utils";
import { parse } from "../../util/files";

const mockMapFileId: jest.Mock = mapFileId as any;
const originalMapFileId = jest.requireActual("./utils").mapFileId;

const initialCharCode = "a".charCodeAt(0);

const mockPartialFiles: Pick<HcBehaviorFile, "id" | "kind">[] = new Array(4)
  .fill(true)
  .map((_, idx) => ({
    id: String(idx),
    kind: HcFileKind.Behavior,
  }));

const dependenciesFile = {
  path: parse("dependencies.json"),
  contents: "",
  repoPath: "dependencies.json",
  kind: HcFileKind.Required,
  id: "dependencies",
} as const;

const mockFiles: HcFile[] = [
  ...mockPartialFiles.map<HcBehaviorFile>((file, idx) => {
    const char = String.fromCharCode(initialCharCode + idx);
    const ext = idx % 2 === 0 ? Ext.Js : Ext.Py;

    return {
      ...file,
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
      keys: defaultBehaviorKeys,
    };
  }),
  dependenciesFile,
];

const mockInitialState: FilesSlice = {
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
};

const mockStateWithFile0 = {
  ...mockInitialState,
  ids: [mockFiles[0].id],
  entities: {
    [mockFiles[0].id]: mockFiles[0],
  },
};

const mockStateWithFiles = {
  ...mockInitialState,
  ids: mockFiles.map((file) => file.id),
  entities: Object.fromEntries(mockFiles.map((file) => [file.id, file])),
};

describe("files slice", () => {
  it("reducer should have a 'normal' initial state", () => {
    expect(filesReducer(undefined, { type: "" })).toEqual(mockInitialState);
  });

  describe("setCurrentFileId", () => {
    it("should remove the current file is set with null", () => {
      const initialState = {
        ...mockStateWithFile0,
        openFileIds: [mockFiles[0].id],
        currentFileId: mockFiles[0].id,
      };
      const state = filesReducer(initialState, setCurrentFileId(null));

      expect(state.openFileIds).toEqual(initialState.openFileIds);
      expect(state.currentFileId).toEqual(null);
    });

    it("should append an open file id, if the file id exists", () => {
      const state = filesReducer(
        mockStateWithFile0,
        setCurrentFileId(mockFiles[0].id)
      );

      expect(state.openFileIds.length).toEqual(1);
      expect(state.openFileIds).toEqual([mockFiles[0].id]);
    });

    it("should not append an open file id if file is already open", () => {
      const state = filesReducer(
        {
          ...mockStateWithFile0,
          openFileIds: [mockFiles[0].id],
        },
        setCurrentFileId(mockFiles[0].id)
      );

      expect(state.openFileIds.length).toEqual(1);
      expect(state.openFileIds).toEqual([mockFiles[0].id]);
    });

    it("should throw, if the file id does not exists", () => {
      expect(() => {
        filesReducer(
          mockStateWithFile0,
          setCurrentFileId(String(mockFiles.length))
        );
      }).toThrowError("Cannot append file that does not exist");
    });

    it("should make the opened file current", () => {
      const state = filesReducer(
        mockStateWithFile0,
        setCurrentFileId(mockFiles[0].id)
      );

      expect(state.currentFileId).toEqual(mockFiles[0].id);
    });

    it("should remove the present replace proposal", () => {
      const state = filesReducer(
        {
          ...mockStateWithFiles,
          replaceProposal: {
            nextContents: "NEXT CONTENTS",
            fileId: mockFiles[0].id,
          },
        },
        setCurrentFileId(mockFiles[0].id)
      );

      expect(state.replaceProposal).toEqual(null);
    });
  });

  describe("closeFile", () => {
    const mockStateWithOpenFile0 = {
      ...mockStateWithFile0,
      openFileIds: [mockFiles[0].id],
    };

    const mockStateWithOpenCurrentFile0 = {
      ...mockStateWithOpenFile0,
      currentFileId: mockFiles[0].id,
    };

    it("should remove an open file id if the file id is 'open'", () => {
      const state = filesReducer(
        mockStateWithOpenFile0,
        closeFile(mockFiles[0].id)
      );

      expect(state.openFileIds.length).toEqual(0);
      expect(state.openFileIds).toEqual([]);
    });

    it("should do nothing if the file id is not 'open'", () => {
      const state = filesReducer(
        mockStateWithOpenFile0,
        closeFile(mockFiles[1].id)
      );

      expect(state.openFileIds.length).toEqual(1);
      expect(state.openFileIds).toEqual([mockFiles[0].id]);
    });

    it("should deselect the current file id if the removed file was 'current'", () => {
      const state = filesReducer(
        mockStateWithOpenCurrentFile0,
        closeFile(mockFiles[0].id)
      );

      expect(state.openFileIds.length).toEqual(0);
      expect(state.openFileIds).toEqual([]);
      expect(state.currentFileId).toEqual(null);
    });

    it("should set the next available open file to current if the removed file was 'current'", () => {
      const state = filesReducer(
        {
          ...mockInitialState,
          ids: [mockFiles[0].id, mockFiles[1].id],
          entities: {
            [mockFiles[0].id]: mockFiles[0],
            [mockFiles[1].id]: mockFiles[1],
          },
          currentFileId: mockFiles[0].id,
          openFileIds: [mockFiles[0].id, mockFiles[1].id],
        },
        closeFile(mockFiles[0].id)
      );

      expect(state.openFileIds.length).toEqual(1);
      expect(state.openFileIds).toEqual([mockFiles[1].id]);
      expect(state.currentFileId).toEqual(mockFiles[1].id);
    });
  });

  describe("closeFilesToTheRight", () => {
    const mockStateWithOpenFile0 = {
      ...mockStateWithFiles,
      openFileIds: [mockFiles[0].id, mockFiles[1].id, mockFiles[2].id],
    };

    it("should leave only one two files opened", () => {
      const state = filesReducer(
        mockStateWithOpenFile0,
        closeFilesToTheRight(mockFiles[1].id)
      );
      expect(state.openFileIds.length).toEqual(2);
      expect(state.openFileIds).toEqual([mockFiles[0].id, mockFiles[1].id]);
    });
  });

  describe("closeOtherFiles", () => {
    const mockStateWithOpenFile0 = {
      ...mockStateWithFiles,
      openFileIds: [mockFiles[0].id],
    };

    it("should leave only one file opened", () => {
      const state = filesReducer(
        mockStateWithOpenFile0,
        closeOtherFiles(mockFiles[0].id)
      );

      expect(state.openFileIds.length).toEqual(1);
      expect(state.openFileIds).toEqual([mockFiles[0].id]);
    });
  });

  describe("closeAllFiles", () => {
    const mockStateWithOpenFile0 = {
      ...mockStateWithFile0,
      openFileIds: [mockFiles[0].id],
    };

    it("should leave no files opened", () => {
      const state = filesReducer(
        mockStateWithOpenFile0,
        closeAllFiles(mockFiles[0].id)
      );

      expect(state.openFileIds.length).toEqual(0);
      expect(state.openFileIds).toEqual([]);
    });
  });

  describe("deleteFile", () => {
    const mockStateWithFilesAndOpenFiles012 = {
      ...mockStateWithFiles,
      openFileIds: [mockFiles[0].id, mockFiles[1].id, mockFiles[2].id],
      currentFileId: mockFiles[0].id,
    };

    it("should delete a file", () => {
      const state = filesReducer(
        mockStateWithFilesAndOpenFiles012,
        deleteFile(mockFiles[0].id)
      );

      expect(state.ids.length).toEqual(mockFiles.length - 1);
      expect(state.openFileIds).toEqual([mockFiles[1].id, mockFiles[2].id]);
      expect(state.currentFileId).toEqual(mockFiles[2].id);
    });

    it("should track a delete action if the file is not a dependency", () => {
      const state = filesReducer(
        mockStateWithFilesAndOpenFiles012,
        deleteFile(mockFiles[0].id)
      );

      expect(state.actions).toEqual([
        {
          type: "delete",
          repoPath: mockFiles[0].repoPath,
          uuid: uuid(),
          saving: false,
        },
        {
          type: "delete",
          repoPath: `${mockFiles[0].repoPath}.json`,
          uuid: uuid(),
          saving: false,
        },
      ]);
    });

    it("should track an update to dependencies if the file is a dependency", () => {
      const state = filesReducer(
        produce(mockStateWithFiles, (draft) => {
          draft.entities.dep = {
            id: "dep",
            ref: "1.0.0",
            path: parse("@dep/foo/foo.js"),
            repoPath: "src/behaviors/foo.js",
          } as HcSharedBehaviorFile;
          draft.ids.push("dep");

          draft.entities.dependencies.contents = JSON.stringify({
            "@dep/foo/foo.js": "1.0.0",
            "@foo/other-dep/other_dep.js": "1.0.0",
          });
        }),
        deleteFile("dep")
      );
      expect(state.actions).toEqual([
        {
          type: "update",
          repoPath: "dependencies.json",
          contents: '{\n  "@foo/other-dep/other_dep.js": "1.0.0"\n}',
          uuid: uuid(),
          saving: false,
        },
      ]);
    });
  });

  describe("setReplaceProposal", () => {
    describe("when setting the replace proposal", () => {
      it("deselects the current file", () => {
        const initialState = {
          ...mockStateWithFiles,
          openFileIds: [mockFiles[0].id],
          currentFileId: mockFiles[0].id,
        };

        const state = filesReducer(
          initialState,
          setReplaceProposal({
            fileId: mockFiles[0].id,
            nextContents: "NEXT CONTENTS",
          })
        );
        expect(state.currentFileId).toEqual(null);
      });

      it("sets the replace proposal", () => {
        const replaceProposal = {
          fileId: mockFiles[0].id,
          nextContents: "NEXT CONTENTS",
        };
        const state = filesReducer(
          mockStateWithFiles,
          setReplaceProposal(replaceProposal)
        );
        expect(state.replaceProposal).toEqual(replaceProposal);
      });
    });

    describe("when removing the replace proposal", () => {
      it("selects the replacing file if a replace proposal is present", () => {
        const initialState = {
          ...mockStateWithFiles,
          openFileIds: [mockFiles[0].id, mockFiles[1].id],
          currentFileId: null,
          replaceProposal: {
            fileId: mockFiles[0].id,
            nextContents: "NEXT CONTENTS",
          },
        };

        const state = filesReducer(initialState, setReplaceProposal(null));
        expect(state.currentFileId).toEqual(mockFiles[0].id);
      });

      it("does not change the current file if a replace proposal is not present", () => {
        const initialState = {
          ...mockStateWithFiles,
          openFileIds: [mockFiles[0].id, mockFiles[1].id],
          currentFileId: mockFiles[0].id,
          replaceProposal: null,
        };

        const state = filesReducer(initialState, setReplaceProposal(null));
        expect(state.currentFileId).toEqual(mockFiles[0].id);
      });

      it("removes the replace proposal", () => {
        const state = filesReducer(
          mockStateWithFiles,
          setReplaceProposal(null)
        );
        expect(state.replaceProposal).toEqual(null);
      });
    });
  });

  describe("updateFile", () => {
    it("should update a file", () => {
      const newContents = "new contents";
      const state = filesReducer(
        mockStateWithFiles,
        updateFile({
          id: mockFiles[0].id,
          contents: newContents,
        })
      );

      expect(state.entities[mockFiles[0].id]!.contents).toEqual(newContents);
    });

    it("should add an update action if there is no action for this file", () => {
      const newContents = "new contents";

      const existingActions: FileAction[] = [
        {
          type: "create",
          contents: "abc",
          repoPath: "src/abc",
          uuid: "1234",
          saving: false,
        },
        {
          type: "delete",
          repoPath: "src/def",
          uuid: "4567",
          saving: false,
        },
      ];

      const state = filesReducer(
        {
          ...mockStateWithFiles,
          actions: existingActions,
        },
        updateFile({
          id: mockFiles[0].id,
          contents: newContents,
        })
      );

      expect(state.actions).toEqual([
        ...existingActions,
        {
          type: "update",
          uuid: uuid(),
          contents: newContents,
          repoPath: mockFiles[0].repoPath,
          saving: false,
        },
      ]);
    });

    it("should add an update action if the last action for this id is not an update", () => {
      const newContents = "new contents";

      const existingActions: FileAction[] = [
        {
          type: "update",
          contents: "abc",
          repoPath: mockFiles[0].repoPath,
          uuid: "4567",
          saving: false,
        },
        {
          type: "delete",
          repoPath: mockFiles[0].repoPath,
          uuid: "4567",
          saving: false,
        },
        {
          type: "create",
          contents: "def",
          repoPath: mockFiles[0].repoPath,
          uuid: "1234",
          saving: false,
        },
      ];

      const state = filesReducer(
        {
          ...mockStateWithFiles,
          actions: existingActions,
        },
        updateFile({
          id: mockFiles[0].id,
          contents: newContents,
        })
      );

      expect(state.actions).toEqual([
        ...existingActions,
        {
          type: "update",
          uuid: uuid(),
          contents: newContents,
          repoPath: mockFiles[0].repoPath,
          saving: false,
        },
      ]);
    });

    it("should modify the last update action for this file if action is not in flight", () => {
      const newContents = "new contents";

      const existingActions: FileAction[] = [
        {
          type: "update",
          contents: "abc",
          repoPath: mockFiles[1].repoPath,
          uuid: "4567",
          saving: false,
        },
      ];

      const state = filesReducer(
        {
          ...mockStateWithFiles,
          actions: [
            {
              type: "update",
              contents: "abc",
              repoPath: mockFiles[0].repoPath,
              uuid: "1234",
              saving: false,
            },
            ...existingActions,
          ],
        },
        updateFile({
          id: mockFiles[0].id,
          contents: newContents,
        })
      );

      expect(state.actions).toEqual([
        {
          type: "update",
          uuid: "1234",
          contents: newContents,
          repoPath: mockFiles[0].repoPath,
          saving: false,
        },
        ...existingActions,
      ]);
    });

    it("should add a new update action for this file if last update action is in flight", () => {
      const newContents = "new contents";

      const existingActions: FileAction[] = [
        {
          type: "update",
          contents: "abc",
          repoPath: mockFiles[1].repoPath,
          uuid: "4567",
          saving: false,
        },
      ];

      const state = filesReducer(
        {
          ...mockStateWithFiles,
          actions: [
            {
              type: "update",
              contents: "abc",
              repoPath: mockFiles[0].repoPath,
              uuid: "1234",
              saving: true,
            },
            ...existingActions,
          ],
        },
        updateFile({
          id: mockFiles[0].id,
          contents: newContents,
        })
      );

      expect(state.actions).toEqual([
        {
          type: "update",
          uuid: "1234",
          contents: "abc",
          repoPath: mockFiles[0].repoPath,
          saving: true,
        },
        ...existingActions,
        {
          type: "update",
          contents: newContents,
          repoPath: mockFiles[0].repoPath,
          saving: false,
          uuid: uuid(),
        },
      ]);
    });
  });

  describe("addDependencies", () => {
    const mockDependenciesState = (
      pendingDependencies: string[] = [],
      deps: DependenciesDescriptor = {},
      fileEntities: Record<string, HcFile> = {}
    ) => ({
      ...mockInitialState,
      ids: ["dependencies", ...Object.keys(fileEntities)],
      entities: {
        ...fileEntities,
        dependencies: {
          id: "dependencies",
          contents: JSON.stringify(deps),
          path: { formatted: "dependencies.json" },
        } as HcFile,
      },
      pendingDependencies,
    });

    const mockDependency = (name: string, version = "1.0.0"): HcFile =>
      ({
        id: name,
        path: { formatted: name },
        ref: version,
      } as HcFile);

    describe("pending", () => {
      it("adds pending dependencies without duplicates", () => {
        expect(
          filesReducer(mockDependenciesState(["a", "b", "c", "d"]), {
            type: addDependencies.pending.type,
            meta: {
              arg: {
                a: "123",
                b: "456",
                e: "789",
              },
            },
          }).pendingDependencies
        ).toEqual(["a", "b", "c", "d", "e"]);
      });
    });

    describe("rejected", () => {
      it("removes the pending dependencies previously added", () => {
        expect(
          filesReducer(mockDependenciesState(["a", "b", "c", "d", "e"]), {
            type: addDependencies.rejected.type,
            meta: {
              arg: {
                a: "123",
                b: "456",
                e: "789",
              },
            },
          }).pendingDependencies
        ).toEqual(["c", "d"]);
      });
    });

    describe("fulfilled", () => {
      it("removes the pending dependencies that are no longer pending", () => {
        expect(
          filesReducer(mockDependenciesState(["a", "b", "c", "d", "e"]), {
            type: addDependencies.fulfilled.type,
            payload: [
              mockDependency("a"),
              mockDependency("b"),
              mockDependency("c"),
            ],
          }).pendingDependencies
        ).toEqual(["d", "e"]);
      });

      describe("when replacing existing dependency", () => {
        it("replaces openFileIds that have the same path with the new id", () => {
          expect(
            filesReducer(
              {
                ...mockDependenciesState(
                  [],
                  { abc: "123" },
                  {
                    abc: mockDependency("abc", "123"),
                  }
                ),
                openFileIds: ["abc", "ghi"],
              },
              {
                type: addDependencies.fulfilled.type,
                payload: [
                  {
                    ...mockDependency("abc", "456"),
                    id: "def",
                  },
                ],
              }
            ).openFileIds
          ).toEqual(["def", "ghi"]);
        });

        it("replaces currentFileId when it has the same path with the new id", () => {
          expect(
            filesReducer(
              {
                ...mockDependenciesState(
                  [],
                  { abc: "123" },
                  {
                    abc: mockDependency("abc", "123"),
                  }
                ),
                currentFileId: "abc",
              },
              {
                type: addDependencies.fulfilled.type,
                payload: [
                  {
                    ...mockDependency("abc", "456"),
                    id: "def",
                  },
                ],
              }
            ).currentFileId
          ).toEqual("def");
        });

        it("replaces old files with new files", () => {
          const state = filesReducer(
            {
              ...mockDependenciesState(
                [],
                { abc: "123" },
                {
                  abc: mockDependency("abc", "123"),
                }
              ),
              currentFileId: "abc",
            },
            {
              type: addDependencies.fulfilled.type,
              payload: [
                {
                  ...mockDependency("abc", "456"),
                  id: "def",
                },
              ],
            }
          );

          expect(state.ids).not.toContain("abc");
          expect(state.ids).toContain("def");

          expect(state.entities).not.toHaveProperty("abc");
          expect(state.entities).toHaveProperty("def");
        });
      });

      it("updates the dependencies list", () => {
        expect(
          filesReducer(
            {
              ...mockDependenciesState(
                [],
                { abc: "123" },
                {
                  abc: mockDependency("abc", "123"),
                }
              ),
              currentFileId: "abc",
            },
            {
              type: addDependencies.fulfilled.type,
              payload: [
                {
                  ...mockDependency("def", "123"),
                },
              ],
            }
          ).entities.dependencies
        ).toMatchInlineSnapshot(`
          Object {
            "contents": "{
            \\"abc\\": \\"123\\",
            \\"def\\": \\"123\\"
          }",
            "id": "dependencies",
            "path": Object {
              "formatted": "dependencies.json",
            },
          }
        `);
      });
    });
  });

  describe("createBehavior", () => {
    it("adds a file", () => {
      const state = filesReducer(
        mockInitialState,
        createBehavior({
          path: parse("foo.js"),
          project: {
            ref: "1.0.0",
          } as SimulationProject,
        })
      );

      expect(state.ids).toEqual(["foo_js_1_0_0"]);
      expect(state.entities["foo_js_1_0_0"]).toEqual({
        id: "foo_js_1_0_0",
        path: parse("foo.js"),
        repoPath: "src/behaviors/foo.js",
        contents:
          "/**\n" +
          " * @param {AgentState} state of the agent\n" +
          " * @param {AgentContext} context of the agent\n" +
          " */\n" +
          "const behavior = (state, context) => {\n\n" +
          "};\n",
        kind: HcFileKind.Behavior,
        keys: {
          ...defaultBehaviorKeys,
          _trackCreation: true,
        },
      });
    });

    it("opens the new file", () => {
      const state = filesReducer(
        mockInitialState,
        createBehavior({
          path: parse("foo.js"),
          project: {
            ref: "1.0.0",
          } as SimulationProject,
        })
      );

      expect(state.openFileIds).toEqual(["foo_js_1_0_0"]);
      expect(state.currentFileId).toEqual("foo_js_1_0_0");
    });

    it("tracks the new file", () => {
      const state = filesReducer(
        mockInitialState,
        createBehavior({
          path: parse("foo.js"),
          project: {
            ref: "1.0.0",
          } as SimulationProject,
        })
      );

      expect(state.actions).toEqual([
        {
          type: "create",
          repoPath: "src/behaviors/foo.js",
          contents:
            "/**\n" +
            " * @param {AgentState} state of the agent\n" +
            " * @param {AgentContext} context of the agent\n" +
            " */\n" +
            "const behavior = (state, context) => {\n\n" +
            "};\n",
          uuid: uuid(),
          saving: false,
        },
      ]);
    });
  });

  describe("renameBehavior", () => {
    beforeEach(() => {
      mockMapFileId.mockImplementation((path, ...args) =>
        path === "foo.js" ? "NEW_ID" : originalMapFileId(path, ...args)
      );
    });

    it("removes the old behavior", () => {
      const state = filesReducer(
        mockStateWithFiles,
        renameBehavior({
          id: mockFiles[0].id,
          newName: "foo.js",
        })
      );

      expect(state.ids).not.toContain(mockFiles[0].id);
      expect(state.entities).not.toHaveProperty(mockFiles[0].id);
    });

    it("updates a file path", () => {
      const state = filesReducer(
        mockStateWithFiles,
        renameBehavior({
          id: mockFiles[0].id,
          newName: "foo.js",
        })
      );

      expect(state.entities.NEW_ID!.path).toEqual(parse("foo.js"));
    });

    it("updates a file repoPath", () => {
      const state = filesReducer(
        mockStateWithFiles,
        renameBehavior({
          id: mockFiles[0].id,
          newName: "foo.js",
        })
      );

      expect(state.entities.NEW_ID!.repoPath).toEqual("src/behaviors/foo.js");
    });

    it("updates the openFileIds", () => {
      const state = filesReducer(
        {
          ...mockStateWithFiles,
          openFileIds: ["abc", "def", mockFiles[0].id, "egh"],
        },
        renameBehavior({
          id: mockFiles[0].id,
          newName: "foo.js",
        })
      );

      expect(state.openFileIds).toEqual(["abc", "def", "NEW_ID", "egh"]);
    });

    it("updates the currentFileId if current is old behavior", () => {
      const state = filesReducer(
        {
          ...mockStateWithFiles,
          openFileIds: ["abc", "def", mockFiles[0].id, "egh"],
          currentFileId: mockFiles[0].id,
        },
        renameBehavior({
          id: mockFiles[0].id,
          newName: "foo.js",
        })
      );

      expect(state.currentFileId).toEqual("NEW_ID");
    });

    it("does not update the currentFileId if current is not old behavior", () => {
      const state = filesReducer(
        {
          ...mockStateWithFiles,
          openFileIds: ["abc", "def", mockFiles[0].id, "egh"],
          currentFileId: "abc",
        },
        renameBehavior({
          id: mockFiles[0].id,
          newName: "foo.js",
        })
      );

      expect(state.currentFileId).toEqual("abc");
    });

    it("tracks the rename", () => {
      const state = filesReducer(
        mockStateWithFiles,
        renameBehavior({
          id: mockFiles[0].id,
          newName: "foo.js",
        })
      );

      expect(state.actions).toEqual([
        {
          type: "move",
          repoPath: "src/behaviors/foo.js",
          oldRepoPath: mockFiles[0].repoPath,
          uuid: uuid(),
          saving: false,
        },
        {
          type: "move",
          repoPath: "src/behaviors/foo.js.json",
          oldRepoPath: `${mockFiles[0].repoPath}.json`,
          uuid: uuid(),
          saving: false,
        },
      ]);
    });
  });

  describe("forkOpenBehavior", () => {
    const dep = {
      id: "dep",
      ref: "1.0.0",
      path: parse("@dep/foo/foo.js"),
      repoPath: "src/behaviors/foo.js",
      contents: "dependency",
      kind: HcFileKind.SharedBehavior,
      keys: defaultBehaviorKeys,
    } as HcSharedBehaviorFile;

    const mockInitialStateWithDependency = produce(
      mockStateWithFiles,
      (draft) => {
        draft.entities.dep = dep;
        draft.ids.push("dep");

        draft.entities.dependencies.contents = JSON.stringify({
          "@dep/foo/foo.js": "1.0.0",
        });
      }
    );

    it("adds a file", () => {
      const state = filesReducer(
        mockInitialStateWithDependency,
        forkOpenBehavior({
          destination: parse("foo.js"),
          source: dep,
          project: {
            ref: "1.0.0",
          } as SimulationProject,
        })
      );

      expect(state.ids).toContain("foo_js_1_0_0");
      expect(state.entities["foo_js_1_0_0"]).toEqual({
        id: "foo_js_1_0_0",
        path: parse("foo.js"),
        repoPath: "src/behaviors/foo.js",
        contents: "dependency",
        kind: HcFileKind.Behavior,
        keys: defaultBehaviorKeys,
      });
    });

    it("opens the new file", () => {
      const state = filesReducer(
        mockInitialStateWithDependency,
        forkOpenBehavior({
          destination: parse("foo.js"),
          source: dep,
          project: {
            ref: "1.0.0",
          } as SimulationProject,
        })
      );

      expect(state.openFileIds).toContain("foo_js_1_0_0");
      expect(state.currentFileId).toEqual("foo_js_1_0_0");
    });

    it("tracks the new file", () => {
      const state = filesReducer(
        mockInitialStateWithDependency,
        forkOpenBehavior({
          destination: parse("foo.js"),
          source: dep,
          project: {
            ref: "1.0.0",
          } as SimulationProject,
        })
      );

      expect(state.actions).toContainEqual({
        type: "create",
        repoPath: "src/behaviors/foo.js",
        contents: "dependency",
        uuid: uuid(),
        saving: false,
      });
    });

    it("removes the old dependency files", () => {
      const state = filesReducer(
        mockInitialStateWithDependency,
        forkOpenBehavior({
          destination: parse("foo.js"),
          source: dep,
          project: {
            ref: "1.0.0",
          } as SimulationProject,
        })
      );

      expect(state.ids).not.toContain(dep.id);
      expect(state.entities).not.toHaveProperty(dep.id);
    });

    it("updates dependencies.json", () => {
      const state = filesReducer(
        mockInitialStateWithDependency,
        forkOpenBehavior({
          destination: parse("foo.js"),
          source: dep,
          project: {
            ref: "1.0.0",
          } as SimulationProject,
        })
      );

      expect(state.entities.dependencies!.contents).toEqual("{}");
    });
  });
});
