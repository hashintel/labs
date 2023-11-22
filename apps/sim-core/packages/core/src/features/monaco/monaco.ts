import { Store } from "@reduxjs/toolkit";
import { IDisposable, Uri, editor } from "monaco-editor";
import { debounce } from "lodash";
import { v4 as uuid } from "uuid";

import type { AppDispatch, RootState } from "../types";
import { Ext } from "../../util/files/enums";
import type { HcFile } from "../files/types";
import { addGitConflictMarkersDecorator } from "./decorators/addGitConflictMarkersDecorator";
import { isReadOnly } from "../files/utils";
import { selectAllFiles, selectFileEntities } from "../files/selectors";
import { selectCurrentProjectUrl } from "../project/selectors";
import { updateFile } from "../files/slice";

type ModelStore = Record<string, editor.ITextModel>;

export const languageByExt: { [ext in Ext]: string } = {
  [Ext.Bpmn]: "xml",
  [Ext.Csv]: "plaintext",
  [Ext.Js]: "javascript",
  [Ext.Json]: "json",
  [Ext.PyJson]: "json",
  [Ext.JsJson]: "json",
  [Ext.RsJson]: "json",
  [Ext.JsonJson]: "json",
  [Ext.CsvJson]: "json",
  [Ext.Py]: "python",
  [Ext.Md]: "markdown",
  [Ext.Rs]: "rust",
  [Ext.Ts]: "typescript",
  [Ext.Txt]: "plaintext",
};

/**
 * This is for storing information about zones that we need to update as the
 * file contents change – we use these zones to add padding to the end of files
 * but unfortunately you have to hard code the line number to insert the zone
 * which means we need to update it whenever the model's contents change to
 * ensure it is always at the end.
 */
const zoneMap = new WeakMap<
  editor.ITextModel,
  { zoneId: string; setEndZone: VoidFunction }
>();

const clickThroughZone = (
  zone: Omit<editor.IViewZone, "suppressMouseDown" | "domNode"> & {
    domNode?: editor.IViewZone["domNode"];
  },
): editor.IViewZone => ({
  ...zone,
  domNode: zone.domNode ?? document.createElement("div"),

  // Allows for clicking "through" the zone to interact with the editor
  suppressMouseDown: true,
});

let gitConflictMarkersDisposable: IDisposable;
let gitDecorations: string[] | undefined;
export const setMonacoModel = (
  editorInstance: editor.ICodeEditor,
  textModel: editor.ITextModel,
) => {
  if (textModel !== editorInstance.getModel()) {
    editorInstance.setModel(textModel);

    /**
     * We use view zones to add some breathing room to the top and bottom of
     * our editor. This is fairly complex for something so simple – but it seems
     * it's the best option we're given…
     *
     * @see https://github.com/microsoft/monaco-editor/issues/1333
     */
    editorInstance.changeViewZones((changeAccessor) => {
      changeAccessor.addZone(
        clickThroughZone({
          afterLineNumber: 0,
          heightInPx: 10,
        }),
      );
    });

    const zone = zoneMap.get(textModel);

    if (!zone) {
      const setEndZone = () => {
        editorInstance.changeViewZones((changeAccessor) => {
          const zone = zoneMap.get(textModel);

          if (zone) {
            changeAccessor.removeZone(zone.zoneId);
          }

          const zoneId = changeAccessor.addZone(
            clickThroughZone({
              afterLineNumber: textModel.getLineCount(),
              heightInLines: 3,
            }),
          );

          zoneMap.set(textModel, {
            setEndZone,
            zoneId,
          });
        });
      };

      setEndZone();
      textModel.onDidChangeContent(setEndZone);
    } else {
      zone.setEndZone();
    }

    if (gitConflictMarkersDisposable) {
      gitConflictMarkersDisposable.dispose();
      editorInstance.deltaDecorations(gitDecorations ?? [], []);
    }
    gitConflictMarkersDisposable = textModel.onDidChangeContent(
      debounce(
        () => {
          editorInstance.deltaDecorations(gitDecorations ?? [], []);
          gitDecorations = addGitConflictMarkersDecorator(
            textModel.getValue(),
            editorInstance,
          );
        },
        500,
        { maxWait: 2000 },
      ),
    );

    gitDecorations = addGitConflictMarkersDecorator(
      textModel.getValue(),
      editorInstance,
    );

    // TODO textModel.onUndo delete the last entry in resolvedCodeLenses (only if it was added)
  }
};

const createMonacoSubscriber = () => {
  let dispatch: AppDispatch;
  let getState: () => RootState;
  let models: ModelStore = {};
  let modelsToDispose: editor.ITextModel[] = [];

  const createTextModel = (file: HcFile): editor.ITextModel => {
    const model = editor.createModel(
      file.contents,
      languageByExt[file.path.ext],
      Uri.parse(`${file.path.formatted}#${uuid()}`),
    );

    if (!isReadOnly(file, true) || !isReadOnly(file, false)) {
      model.onDidChangeContent(() => {
        const contents = model.getValue();

        if (!document.hasFocus()) {
          return;
        }

        if (contents !== selectFileEntities(getState!())[file.id]?.contents) {
          dispatch(updateFile({ id: file.id, contents }));
        }
      });
    }

    return model;
  };

  const getModelId = (file: HcFile, manifestId: string | null) =>
    `${manifestId ?? "project"}.${file.id}`;

  const getTextModel = (file: HcFile, manifestId: string | null) =>
    models[getModelId(file, manifestId)];

  const getTextModelRequired = (file: HcFile, manifestId: string | null) => {
    const model = getTextModel(file, manifestId);

    if (!model) {
      throw new Error("text model does not exist");
    }

    return model;
  };

  return {
    getTextModel,
    getTextModelRequired,

    subscribe(store: Store<RootState>) {
      // @ts-expect-error redux problems
      dispatch = store.dispatch;
      getState = store.getState;

      store.subscribe(() => {
        for (const model of modelsToDispose) {
          model.dispose();
        }

        modelsToDispose = [];

        const nextState = store.getState();

        const projectUrl = selectCurrentProjectUrl(nextState);
        const newModels: ModelStore = {};

        for (const file of selectAllFiles(nextState)) {
          const modelId = getModelId(file, projectUrl);
          const model = models[modelId] ?? createTextModel(file);

          if (model.getValue() !== file.contents) {
            model.setValue(file.contents);
          }

          newModels[modelId] = model;
        }

        /**
         * We defer the disposal of models until the next dispatch because React
         * may not yet have re-rendered without the state that relies on this
         * model just yet
         */
        modelsToDispose = Object.entries(models).reduce<editor.ITextModel[]>(
          (modelsToDispose, [modelId, model]) => {
            if (!newModels[modelId]) {
              modelsToDispose.push(model);
            }

            return modelsToDispose;
          },
          [],
        );

        models = newModels;
      });
    },
  };
};

export const { getTextModel, getTextModelRequired, subscribe } =
  createMonacoSubscriber();
