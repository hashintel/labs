import { useDocHandle } from "@automerge/automerge-repo-react-hooks";
import type { EditorProps } from "@patchwork/sdk";
import type React from "react";
import type { Doc } from "./datatype";
import { Petrinaut } from "@hashintel/petrinaut";

export const Tool: React.FC<EditorProps<Doc, string>> = ({ docUrl }) => {
	const handle = useDocHandle<Doc>(docUrl, { suspense: true });

	const doc = handle.doc();
	if (!doc) return null;

	return (
		<Petrinaut
			key={docUrl}
			hideNetManagementControls
			petriNetId={docUrl}
			petriNetDefinition={doc.petriNetDefinition}
			existingNets={[]}
			mutatePetriNetDefinition={(mutationFn) => {
				handle.change((d) => {
					mutationFn(d.petriNetDefinition);
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
