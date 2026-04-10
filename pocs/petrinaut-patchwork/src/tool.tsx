import {
	RepoContext,
	useDocHandle,
	useDocument,
} from "@automerge/automerge-repo-react-hooks";
import "@hashintel/petrinaut/dist/main.css";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { Doc } from "./datatype";
import { Petrinaut } from "@hashintel/petrinaut";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

export const PetrinautEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
	const [doc, changeDoc] = useDocument<Doc>(docUrl, { suspense: true });

	if (!doc) return null;

	return (
		<Petrinaut
			key={docUrl}
			hideNetManagementControls
			petriNetId={docUrl}
			petriNetDefinition={doc.petriNetDefinition}
			existingNets={[]}
			mutatePetriNetDefinition={(mutationFn) => {
				changeDoc((doc) => {
					mutationFn(doc.petriNetDefinition);
				});
			}}
			createNewNet={() => {
				throw new Error(
					"Creation currently not supported via Patchwork wrapper",
				);
			}}
			loadPetriNet={() => {
				throw new Error(
					"Loading other nets not supported via Patchwork wrapper",
				);
			}}
			readonly={false}
			setTitle={() => {
				throw new Error("setTitle handled by Patchwork data type");
			}}
			title={""}
		/>
	);
};

export function toolify(editorComponent: React.FC<any>): ToolImplementation {
	return (handle, element) => {
		const root = createRoot(element);

		root.render(
			createElement(
				RepoContext.Provider,
				{ value: element.repo },
				createElement(editorComponent, {
					docUrl: handle.url,
					element,
				}),
			),
		);

		return () => {
			root.unmount();
		};
	};
}

export const renderPetrinautEditor = toolify(PetrinautEditor);
