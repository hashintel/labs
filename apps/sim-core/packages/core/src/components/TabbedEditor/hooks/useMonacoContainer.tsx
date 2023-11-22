import React, {
  createContext,
  FC,
  RefCallback,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { editor } from "monaco-editor";

import {
  DiffEditorInstance,
  EditorConstructionsOptions,
  EditorInstance,
} from "../types";
import {
  useOncePerFrameHandler,
  useResizeObserver,
} from "../../../hooks/useResizeObserver/useResizeObserver";

const layoutPanePrimary = ".layout-pane-primary";
const overflowVisible = "overflow-visible";
const ariaHidden = "aria-hidden";
const contextView = ".context-view";
const reactTabs = ".react-tabs";

const editorOptions: EditorConstructionsOptions = {
  automaticLayout: true,
  fixedOverflowWidgets: true,
  scrollBeyondLastLine: false,
  fontFamily: "var(--code-font)",
  theme: "hash",
  scrollbar: {
    horizontalScrollbarSize: 3,
    verticalScrollbarSize: 3,
    vertical: "visible",
  },
};

/**
 * We want to use the shortcuts attached to these commands for our own purposes,
 * so we remove monaco's binding for them to allow them to bubble up to our app
 */
const disallowedBindings = [
  "-editor.action.insertLineBefore",
  "-editor.action.insertLineAfter",
  "-openReferenceToSide",
];

function createEditorInstance(container: HTMLElement): EditorInstance {
  const instance = editor.create(container, editorOptions);

  for (const binding of disallowedBindings) {
    /**
     * Unfortunately, we have to use a private API for this…
     *
     * @see https://github.com/microsoft/monaco-editor/issues/102#issuecomment-701704517
     */
    (instance as any)._standaloneKeybindingService.addDynamicKeybinding(
      binding,
      null,
      () => {},
    );
  }

  return instance;
}

function createDiffEditorInstance(container: HTMLElement): DiffEditorInstance {
  return editor.createDiffEditor(container, {
    ...editorOptions,
    enableSplitViewResizing: false,
    renderSideBySide: false,
  });
}

const query = (el: ParentNode | null, sel: string) => el?.querySelector(sel);
const isEl = (el: any): el is Element => "getAttribute" in el;
const attr = (el: any, name: string) => (isEl(el) ? el.getAttribute(name) : "");

type MonacoContainerHook<EditorType> = [
  EditorType | undefined,
  RefCallback<HTMLDivElement>,
];
export type DiffMonacoContainerHook = MonacoContainerHook<DiffEditorInstance>;
export type MainMonacoContainerHook = MonacoContainerHook<EditorInstance>;

export function useMonacoContainer(diff: true): DiffMonacoContainerHook;
export function useMonacoContainer(diff?: false): MainMonacoContainerHook;
export function useMonacoContainer(
  diff = false,
): MonacoContainerHook<DiffEditorInstance | EditorInstance> {
  const [editorInstance, setEditorInstance] = useState<
    EditorInstance | DiffEditorInstance
  >();
  const monacoContainerRef = useRef<HTMLDivElement | null>(null);

  const handler = useOncePerFrameHandler(() => {
    editorInstance?.layout();
  });

  const setFirstObserver = useResizeObserver(handler, {
    onObserve: null,
  });

  const setSecondObserver = useResizeObserver(handler, {
    onObserve: null,
  });

  useEffect(() => {
    if (!editorInstance || !monacoContainerRef.current) {
      return;
    }

    const contextMenuObserver = new MutationObserver(
      ([{ target, attributeName }]) => {
        if (attr(target, attributeName ?? ariaHidden) !== "true") {
          monacoContainerRef.current
            ?.closest(layoutPanePrimary)
            ?.classList.add(overflowVisible);

          return;
        }

        monacoContainerRef.current
          ?.closest(layoutPanePrimary)
          ?.classList.remove(overflowVisible);
      },
    );

    const contextMenuEl = query(monacoContainerRef.current, contextView);
    if (contextMenuEl) {
      contextMenuObserver.observe(contextMenuEl, {
        attributes: true,
        attributeFilter: [ariaHidden],
        attributeOldValue: true,
      });
    }

    const editorEl = monacoContainerRef.current.parentElement;
    if (editorEl) {
      setFirstObserver(editorEl);
    }

    const reactTabsEl = query(editorEl, reactTabs);
    if (reactTabsEl) {
      setSecondObserver(reactTabsEl as HTMLElement);
    }

    return () => {
      setFirstObserver(null);
      setSecondObserver(null);
      contextMenuObserver.disconnect();
      editorInstance.dispose();
    };
  }, [editorInstance, setFirstObserver, setSecondObserver]);

  const setContainerRef = useCallback(
    (ref: HTMLDivElement | null) => {
      if (ref) {
        if (ref !== monacoContainerRef.current) {
          monacoContainerRef.current = ref;
          const editorInstance = diff
            ? createDiffEditorInstance(ref)
            : createEditorInstance(ref);
          setEditorInstance(editorInstance);
        }
      } else {
        monacoContainerRef.current = ref;
        setEditorInstance(undefined);
      }
    },
    [diff],
  );

  return useMemo(
    () => [editorInstance, setContainerRef],
    [editorInstance, setContainerRef],
  );
}

const MonacoContext = createContext<{
  main: MainMonacoContainerHook;
  diff: DiffMonacoContainerHook;
} | null>(null);

export const MonacoContainerProvider: FC = ({ children }) => {
  const main = useMonacoContainer();
  const diff = useMonacoContainer(true);
  const hook = useMemo(() => ({ main, diff }), [main, diff]);

  return (
    <MonacoContext.Provider value={hook}>{children}</MonacoContext.Provider>
  );
};

export function useMonacoContainerFromContext(
  diff: true,
): DiffMonacoContainerHook;
export function useMonacoContainerFromContext(
  diff?: false,
): MainMonacoContainerHook;
export function useMonacoContainerFromContext(
  diff = false,
): MainMonacoContainerHook | DiffMonacoContainerHook {
  const context = useContext(MonacoContext);

  if (!context) {
    throw new Error(
      "Cannot call useMonacoContainerFromContext from outside of MonacoContainerProvider",
    );
  }

  return diff ? context.diff : context.main;
}
