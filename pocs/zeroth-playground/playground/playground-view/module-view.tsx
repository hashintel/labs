import { useState } from "react";
import { Group, Panel as ResizablePanel, Separator, usePanelRef } from "react-resizable-panels";

import { MonacoEditor } from "../editor/monaco-editor";
import { DiagnosticsList } from "./diagnostics-list";
import { FileList } from "./file-list";
import { type Hover, hoverAtLine, litLines } from "./hover";
import { Panel } from "../ui/panel";
import { RESIZE_TARGET } from "../ui/resize-target";
import { useFolds } from "../ui/use-folds";

import type { Compilation } from "../../compiler";

import "../ui/resizable.css";
import "./module-view.css";

type ModuleViewProps = {
  /** Names the editor's models, so undo never reaches another example's text. */
  exampleId: string;
  compilation: Compilation;
  hover: Hover | null;
  onHover: (hover: Hover | null) => void;
  onRevealIrLine: (line: number) => void;
};

const REFUSED = "# Cannot compile this net. See the errors below.\n";
const NO_DOCUMENT = "# Enter a valid Petri net to see the Python.\n";

export const ModuleView: React.FC<ModuleViewProps> = ({
  exampleId,
  compilation,
  hover,
  onHover,
  onRevealIrLine,
}) => {
  const [selectedPath, setSelectedPath] = useState("net.py");
  const filesRef = usePanelRef();
  const folds = useFolds(["files"], () => filesRef.current);
  const paths = compilation.files.map((file) => file.path);
  const file =
    compilation.files.find((candidate) => candidate.path === selectedPath) ??
    compilation.files[0];
  const path = file?.path ?? "net.py";
  const text =
    file === undefined
      ? compilation.ir === null
        ? NO_DOCUMENT
        : REFUSED
      : file.text;
  const trace = file?.trace ?? [];
  const code = (
    <div className="fill">
      <MonacoEditor
        path={`${exampleId}/module/${path}`}
        language="python"
        value={text}
        readOnly
        stickyScroll
        trace={trace}
        decorations={litLines("module", trace, hover)}
        onHoverLine={(line) => onHover(hoverAtLine("module", trace, line))}
      />
    </div>
  );

  return (
    <div className="module">
      <div className="module__main">
        {paths.length > 1 ? (
          <Group
            orientation="horizontal"
            className={folds.easing ? "stack stack--easing" : "stack"}
            resizeTargetMinimumSize={RESIZE_TARGET}
            onLayoutChange={folds.sync}
          >
            <ResizablePanel id="code" minSize="40%">
              {code}
            </ResizablePanel>
            <Separator className="gridline gridline--column" />
            <ResizablePanel
              id="files"
              panelRef={filesRef}
              collapsible
              collapsedSize="2rem"
              minSize="7.5rem"
              maxSize="45%"
              defaultSize="11rem"
            >
              <Panel title="Files" fold={folds.foldOf("files", "end")}>
                <FileList paths={paths} selected={path} onSelect={setSelectedPath} />
              </Panel>
            </ResizablePanel>
          </Group>
        ) : (
          code
        )}
      </div>
      <DiagnosticsList
        errors={compilation.errors}
        warnings={compilation.warnings}
        onReveal={onRevealIrLine}
      />
    </div>
  );
};
