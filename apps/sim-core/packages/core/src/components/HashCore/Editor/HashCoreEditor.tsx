import React, {
  CSSProperties,
  FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import { Tab, TabPanel } from "react-tabs";
import { useModal } from "react-modal-hook";

import { AppDispatch } from "../../../features/types";
import { HashCoreContextMenu } from "../ContextMenu";
import { HashCoreEditorBehaviorKeysFileAction } from "./HashCoreEditorBehaviorKeysFileAction";
import { HashCoreEditorFile } from "./HashCoreEditorFile";
import { HcFileKind } from "../../../features/files/enums";
import {
  IconClose,
  IconHelpCircle,
  IconPlus,
  IconTableLarge,
} from "../../Icon";
import { IconCodeTagsCheck } from "../../Icon/CodeTagsCheck";
import { MonacoContainer } from "../../MonacoContainer";
import {
  Scope,
  selectCanToggleVisualGlobals,
  selectVisualGlobalsVisible,
  useScope,
} from "../../../features/scopes";
import { SimpleTooltip } from "../../SimpleTooltip";
import { TabActionBar } from "../../TabActionBar/TabActionBar";
import {
  TabbedEditorDiffPanel,
  useMonacoContainerFromContext,
} from "../../TabbedEditor";
import { ViewStates } from "../../TabbedEditor/Panel/TabbedEditorPanel";
import { analysisFileId, globalsFileId } from "../../../features/files/utils";
import {
  closeAllFiles,
  closeFile,
  closeFilesToTheRight,
  closeOtherFiles,
  setCurrentFileId,
  toggleVisualGlobals,
} from "../../../features/files/slice";
import {
  fileActionSize,
  getDocsSection,
  validateAnalysisJsonAndDispatchErrorsIfAny,
} from "./utils";
import {
  selectCurrentFile,
  selectCurrentFileId,
  selectOpenFileIds,
  selectOpenFiles,
  selectParsedAnalysis,
  selectReplaceProposal,
  selectShouldShowBehaviorKeys,
} from "../../../features/files/selectors";
import {
  selectEditorVisible,
  selectEmbedded,
} from "../../../features/viewer/selectors";
import { trackEvent } from "../../../features/analytics";
import { useNameNewBehaviorModal } from "../Files";
import { useOnClickOutside } from "../../../hooks/useOnClickOutside";
import { useResizeObserver } from "../../../hooks/useResizeObserver/useResizeObserver";

import "./HashCoreEditor.scss";

/**
 * @todo this needs splitting up further
 */
export const HashCoreEditor: FC = () => {
  const [, setMonacoContainer] = useMonacoContainerFromContext();

  const dispatch = useDispatch<AppDispatch>();
  const openFiles = useSelector(selectOpenFiles);
  const openFileIds = useSelector(selectOpenFileIds);
  const currentFileId = useSelector(selectCurrentFileId);
  const currentFile = useSelector(selectCurrentFile);
  const replaceProposal = useSelector(selectReplaceProposal);
  const analysis = useSelector(selectParsedAnalysis);

  const [diffEditorInstance, monacoDiffContainerRef] =
    useMonacoContainerFromContext(true);
  const [nextContents, setNextContents] = useState<string | null>(null);

  useEffect(() => {
    setNextContents(null);
  }, [currentFileId]);

  const showModalNewBehavior = useNameNewBehaviorModal();

  const tabsRef = useRef<HTMLElement | null>(null);

  const [didFallback, setDidFallback] = useState(false);
  const [tabsContentHeight, setTabsContentHeight] = useState<
    number | undefined
  >();

  const tabsContainerRef = useRef<HTMLDivElement | null>(null);
  const tabsListRef = useRef<HTMLUListElement | null>(null);

  const updateTabsContentHeight = useCallback(() => {
    const tabsContainer = tabsContainerRef.current;
    const tabsList = tabsListRef.current;

    setTabsContentHeight(
      tabsContainer && tabsList
        ? tabsContainer.clientHeight - tabsList.clientHeight
        : undefined,
    );
  }, []);

  const setTabsContainerResizeObserver = useResizeObserver(
    updateTabsContentHeight,
    { onObserve: null },
  );
  const setTabsListResizeObserver = useResizeObserver(updateTabsContentHeight, {
    onObserve: null,
  });

  const setTabContainerRef = useCallback(
    (node: HTMLDivElement) => {
      tabsContainerRef.current = node;
      setTabsContainerResizeObserver(node);

      if (node) {
        const tabsList = node.querySelector<HTMLUListElement>(
          ".react-tabs__tab-list",
        );

        tabsListRef.current = tabsList;
        setTabsListResizeObserver(tabsList);

        updateTabsContentHeight();
      } else {
        tabsListRef.current = null;
        setTabsListResizeObserver(null);
      }
    },
    [
      setTabsContainerResizeObserver,
      setTabsListResizeObserver,
      updateTabsContentHeight,
    ],
  );

  const editorVisible = useSelector(selectEditorVisible);
  const shouldShowGlobalEditor = useSelector(selectVisualGlobalsVisible);
  const shouldShowBehaviorKeys = useSelector(selectShouldShowBehaviorKeys);
  const section = getDocsSection(currentFile, shouldShowBehaviorKeys);

  const editorViewStates = useRef<ViewStates>({});

  const canToggleVisualGlobals = useSelector(selectCanToggleVisualGlobals);

  const [contextMenuStyle, setContextMenuStyle] = useState<
    Pick<CSSProperties, "top" | "left">
  >({
    top: 0,
    left: 0,
  });
  const [currentOpenFileInEditor, setCurrentOpenFileInEditor] = useState("");
  const [showContextMenu, hideContextMenu] = useModal(
    () => (
      <HashCoreContextMenu style={contextMenuStyle}>
        <li>
          <button
            onClick={(evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              dispatch(closeFile(currentOpenFileInEditor));
            }}
          >
            Close
          </button>
        </li>
        <li>
          <button
            onClick={(evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              dispatch(closeOtherFiles(currentOpenFileInEditor));
            }}
          >
            Close Others
          </button>
        </li>
        <li>
          <button
            onClick={(evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              dispatch(closeFilesToTheRight(currentOpenFileInEditor));
            }}
          >
            Close to the Right
          </button>
        </li>
        <li>
          <button
            onClick={(evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              dispatch(closeAllFiles(currentOpenFileInEditor));
            }}
          >
            Close All
          </button>
        </li>
      </HashCoreContextMenu>
    ),
    [contextMenuStyle, dispatch, currentOpenFileInEditor],
  );

  useOnClickOutside(tabsRef, hideContextMenu);

  const embedded = useSelector(selectEmbedded);

  const canSave = useScope(Scope.save);
  const canShowBehaviorKeys =
    currentFile?.kind === HcFileKind.Behavior ||
    currentFile?.kind === HcFileKind.SharedBehavior;

  return (
    <div className="HashCoreEditor" ref={setTabContainerRef}>
      <TabActionBar
        className="HashCoreEditor__Tabs"
        hidden={embedded}
        tabs={
          <>
            {openFiles.map((file) =>
              editorVisible || file.id === globalsFileId ? (
                <Tab
                  key={file.id}
                  onClick={() => {
                    dispatch(setCurrentFileId(file.id));
                  }}
                  className={`react-tabs__tab tab-${file.id}`}
                  onContextMenu={(evt) => {
                    evt.preventDefault();
                    setContextMenuStyle({
                      left: evt.pageX,
                      top: evt.pageY,
                    });
                    setCurrentOpenFileInEditor(file.id);
                    showContextMenu();
                  }}
                >
                  {file.path.base}
                  {editorVisible ? (
                    <button
                      className="tab-button"
                      onClick={(evt) => {
                        evt.stopPropagation();
                        dispatch(closeFile(file.id));
                      }}
                    >
                      <IconClose size={8} />
                    </button>
                  ) : null}
                </Tab>
              ) : null,
            )}
            {editorVisible ? (
              <>
                {replaceProposal.proposal && replaceProposal.file ? (
                  <Tab className="react-tabs__tab tab-replace-proposal">
                    <em>
                      {replaceProposal.file.path.formatted} (Replace Preview)
                    </em>
                  </Tab>
                ) : null}

                {canSave ? (
                  <li className="react-tabs__tab react-tabs__tab--button">
                    <button
                      className="tab-button"
                      onClick={showModalNewBehavior}
                    >
                      <IconPlus size={8} />
                    </button>
                  </li>
                ) : null}
              </>
            ) : null}
          </>
        }
        actions={[
          canShowBehaviorKeys ? (
            <HashCoreEditorBehaviorKeysFileAction key="behavior-keys" />
          ) : null,
          canToggleVisualGlobals ? (
            <button
              onClick={(evt) => {
                evt.preventDefault();
                dispatch(toggleVisualGlobals());
              }}
              className="tab-button"
              key="visual-globals"
            >
              <IconTableLarge size={fileActionSize} />
              <SimpleTooltip
                className="TabActionBar__Actions__Tooltip"
                position="below"
                align="right"
              >
                <h4>Toggle Visual Globals</h4>
                <p>
                  {shouldShowGlobalEditor ? (
                    <>Switch to raw JSON view</>
                  ) : (
                    <>Explore and modify global variables visually</>
                  )}
                </p>
              </SimpleTooltip>
            </button>
          ) : null,
          editorVisible && currentFileId === analysisFileId ? (
            <button
              key="validate-analysis-json"
              className="tab-button"
              onClick={(event) => {
                event.preventDefault();
                if (typeof analysis === "object") {
                  /**
                   * validateAnalysisJsonAndDispatchErrorsIfAny assumes more
                   * about the structure of analysis than we can actually be
                   * sure of, because its just JSON.
                   *
                   * @todo fix this
                   */
                  dispatch(
                    trackEvent({
                      action: "Validate Analysis JSON Button clicked: Core",
                      label: "analysis.json",
                    }),
                  );
                  validateAnalysisJsonAndDispatchErrorsIfAny(
                    analysis as any,
                    dispatch,
                  );
                }
              }}
            >
              <IconCodeTagsCheck size={fileActionSize} />
              <SimpleTooltip
                className="TabActionBar__Actions__Tooltip"
                position="below"
                align="right"
              >
                <h4>Validate file</h4>
                <p>
                  Find out about possible analysis errors before you run your
                  simulation.
                </p>
              </SimpleTooltip>
            </button>
          ) : null,
          <a
            key="help"
            className="tab-button"
            href={`https://docs.hash.ai/core/creating-simulations/${section}`}
            target="_blank"
            onClick={() =>
              dispatch(
                trackEvent({
                  action: "Docs Link Clicked: Core",
                  label: section,
                }),
              )
            }
            rel="noreferrer"
          >
            <IconHelpCircle size={fileActionSize} />
            <SimpleTooltip
              className="TabActionBar__Actions__Tooltip"
              position="below"
              align="right"
              flatRight
            >
              <h4>View Docs</h4>
              <p>Get context-specific help with building your model</p>
            </SimpleTooltip>
          </a>,
        ]}
        tabsRef={tabsRef}
        selectedIndex={
          replaceProposal.proposal
            ? openFileIds.length
            : currentFileId
              ? openFileIds.indexOf(currentFileId)
              : openFileIds.length - 1
        }
      >
        {openFiles.map((file) => (
          <TabPanel key={file.id}>
            <HashCoreEditorFile
              file={file}
              onDidFallbackChange={setDidFallback}
              tabsHeight={tabsContentHeight}
              viewStatesRef={editorViewStates}
              nextContents={nextContents}
              onNextContentsChange={setNextContents}
            />
          </TabPanel>
        ))}
        {replaceProposal.proposal && replaceProposal.file ? (
          <TabPanel>
            <TabbedEditorDiffPanel
              editorInstance={diffEditorInstance}
              file={replaceProposal.file}
              nextContents={replaceProposal.proposal.nextContents}
            />
          </TabPanel>
        ) : null}
      </TabActionBar>

      <MonacoContainer
        ref={setMonacoContainer}
        hidden={
          !!replaceProposal.proposal ||
          !currentFileId ||
          nextContents !== null ||
          (currentFile?.kind === HcFileKind.Dataset && !didFallback) ||
          (currentFileId === globalsFileId && shouldShowGlobalEditor)
        }
      />
      <MonacoContainer
        ref={monacoDiffContainerRef}
        hidden={
          (!currentFileId || nextContents === null) && !replaceProposal.proposal
        }
      />
    </div>
  );
};

// HashCoreEditor.whyDidYouRender = {
//   // this is needed because the compenent is wrapped in `memo` so it's
//   // `displayName` is `undefined` ... apparently `@welldone-software/why-did-
//   // you-render`'s types are somewhat incomplete
//   //
//   // @ts-expect-error
//   customName: "HashCoreEditor"
// };
