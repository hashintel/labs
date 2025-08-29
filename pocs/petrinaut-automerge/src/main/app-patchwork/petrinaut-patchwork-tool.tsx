import { type AutomergeUrl, useDocument } from "@automerge/react";
import { Petrinaut, type PetriNetDefinitionObject } from "../vendor/petrinaut";

export type PetriNetDoc = {
	petriNetDefinition: PetriNetDefinitionObject;
	title: string;
};

/**
 * A wrapper around Petrinaut designed to be inserted as a [Patchwork](https://www.inkandswitch.com/patchwork/notebook/) tool.
 *
 * Hides controls related to net title editing, net selection, and net creation, as these are managed by Patchwork.
 */
export const PetrinautPatchworkTool = ({
	docUrl,
}: {
	docUrl: AutomergeUrl;
}) => {
	const [netDefinition, changeNetDefinition] = useDocument<PetriNetDoc>(
		docUrl,
		{ suspense: true },
	);

	return (
		<Petrinaut
			key={docUrl}
			hideNetManagementControls
			petriNetId={docUrl}
			petriNetDefinition={netDefinition.petriNetDefinition}
			existingNets={[]}
			mutatePetriNetDefinition={(definitionMutationFn) => {
				changeNetDefinition((doc) => {
					definitionMutationFn(doc.petriNetDefinition);
				});
			}}
			parentNet={null}
			createNewNet={() => {
				throw new Error(
					"Petrinaut should not be attemping to create new nets when wrapped by Patchwork",
				);
			}}
			loadPetriNet={() => {
				throw new Error(
					"Petrinaut should not be attemping to load other nets when wrapped by Patchwork",
				);
			}}
			setTitle={() => {
				throw new Error(
					"Petrinaut should not be attemping to set the net title when wrapped by Patchwork",
				);
			}}
			title={""}
		/>
	);
};
