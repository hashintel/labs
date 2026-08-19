import "@hashintel/petrinaut/dist/main.css";
import type {
	DocHandle,
	DocHandleChangePayload,
} from "@automerge/automerge-repo";
import { Petrinaut } from "@hashintel/petrinaut";
import type {
	DocHandleState,
	PetrinautDocHandle,
	ReadableStore,
} from "@hashintel/petrinaut";
import { createLanguageServerWorker } from "@hashintel/petrinaut-core/workers/lsp";
import { createMonteCarloWorker } from "@hashintel/petrinaut-core/workers/monte-carlo";
import { createSimulationWorker } from "@hashintel/petrinaut-core/workers/simulation";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { createElement, useMemo } from "react";
import { createRoot } from "react-dom/client";
import type { Doc } from "./datatype";

export const renderPetrinautEditor: ToolImplementation<Doc> = (
	handle,
	element,
) => {
	const root = createRoot(element);

	root.render(createElement(PetrinautEditor, { handle }));

	return () => {
		root.unmount();
	};
};

export const PetrinautEditor = ({ handle }: { handle: DocHandle<Doc> }) => {
	const netHandle = useMemo(() => toPetrinautHandle(handle), [handle]);

	return (
		<Petrinaut
			key={handle.url}
			handle={netHandle}
			hideNetManagementControls="all"
			simulationWorkerFactory={createSimulationWorker}
			monteCarloWorkerFactory={createMonteCarloWorker}
			lspWorkerFactory={createLanguageServerWorker}
		/>
	);
};

/**
 * Petrinaut drives the net through its own handle interface over a bare SDCPN.
 * Patchwork hands us an Automerge handle for the whole document, so project the
 * net out of it and write edits back in place, leaving the title and
 * `@patchwork` metadata wrapped around it untouched.
 */
function toPetrinautHandle(handle: DocHandle<Doc>): PetrinautDocHandle {
	return {
		id: handle.url,
		state: READY,
		whenReady: () => Promise.resolve(),
		doc: () => handle.doc()?.petriNetDefinition,
		change: (fn) => {
			handle.change((doc) => fn(doc.petriNetDefinition));
		},
		subscribe: (listener) => {
			const onChange = ({ doc, patchInfo }: DocHandleChangePayload<Doc>) => {
				listener({
					next: doc.petriNetDefinition,
					source: LOCAL_PATCH_SOURCES.has(patchInfo.source)
						? "local"
						: "remote",
				});
			};
			handle.on("change", onChange);
			return () => handle.off("change", onChange);
		},
	};
}

/** Everything else Automerge reports — merges, sync messages — came from a peer. */
const LOCAL_PATCH_SOURCES = new Set(["change", "changeAt", "emptyChange"]);

/** Patchwork only renders a tool once the document is loaded, so this never moves. */
const READY: ReadableStore<DocHandleState> = {
	get: () => "ready",
	subscribe: () => () => {},
};
