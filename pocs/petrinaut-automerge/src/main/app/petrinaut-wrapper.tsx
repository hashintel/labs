import {
	type AutomergeUrl,
	useDocuments,
	type Doc,
	type ChangeFn,
	updateText,
	useDocHandle,
	type Patch,
	type DocHandle,
} from "@automerge/react";
import {
	type MinimalNetMetadata,
	Petrinaut,
	type PetriNetDefinitionObject,
} from "@hashintel/petrinaut";
import { useEffect, useMemo, useRef } from "react";
import type { RootDocument } from "../../rootDoc";

export type PetriNet = {
	petriNetDefinition: PetriNetDefinitionObject;
	title: string;
};

const getPatches = (handle: DocHandle<PetriNet>) => {
	const history = handle.history();

	if (!history) {
		return [];
	}

	const patchesByVersion: Patch[][] = [];

	for (let i = 0; i < history.length; i++) {
		const baseVersion = history[i - 1] ?? [];
		const targetVersion = history[i];

		if (!targetVersion) {
			continue;
		}

		const patches = handle.diff(baseVersion, targetVersion);

		if (!patches) {
			continue;
		}

		patchesByVersion.push(patches);
	}

	return patchesByVersion;
};

export const PetrinautWrapper = ({
	changePetriNetDoc,
	createAndSelectPetriNet,
	loadPetriNetFromUrl,
	rootDoc,
	selectedPetriNetUrl,
	selectedPetriNetDoc,
}: {
	changePetriNetDoc: (changeFn: ChangeFn<PetriNet>) => void;
	createAndSelectPetriNet: (petriNet: PetriNet | null) => void;
	loadPetriNetFromUrl: (url: AutomergeUrl) => void;
	rootDoc: RootDocument;
	selectedPetriNetUrl: AutomergeUrl;
	selectedPetriNetDoc: Doc<PetriNet>;
}) => {
	console.log("Rendered PetrinautWrapper");

	console.log(
		"Before useDocuments, rootDoc.petriNetUrls",
		rootDoc.petriNetUrls,
	);
	const [petriNetDocs] = useDocuments<PetriNet>(rootDoc.petriNetUrls);
	console.log({ petriNetDocs });

	const minimalPetriNets = useMemo(() => {
		const nets: MinimalNetMetadata[] = [];

		for (const [automergeUrl, doc] of petriNetDocs.entries()) {
			nets.push({
				netId: automergeUrl,
				title: doc.title,
			});
		}

		return nets;
	}, [petriNetDocs]);

	const handle = useDocHandle<PetriNet>(selectedPetriNetUrl);

	/**
	 * @todo is there a better way of computing the latest patches?
	 *   – currently using refs because component will re-render when the doc changes anyway, so don't want to set in state.
	 *   - can't use handle.on("change") because this is only triggered when connected peers send change events(?)
	 */
	const historyLastComputedFromHead = useRef<string | null>(null);

	useEffect(() => {
		if (!handle) {
			return;
		}

		/**
		 * @todo in what circumstances is there more than one head, and what do we do about it?
		 */
		const head = handle.heads()[0];

		if (head === historyLastComputedFromHead.current) {
			return;
		}

		historyLastComputedFromHead.current = head;

		const latestPatches = getPatches(handle);

		console.log({ latestPatches });
	});

	return (
		<Petrinaut
			petriNetId={selectedPetriNetUrl}
			existingNets={minimalPetriNets}
			createNewNet={createAndSelectPetriNet}
			parentNet={null}
			petriNetDefinition={selectedPetriNetDoc.petriNetDefinition}
			mutatePetriNetDefinition={(definitionMutationFn) => {
				changePetriNetDoc((petriNet) => {
					definitionMutationFn(petriNet.petriNetDefinition);
				});
			}}
			loadPetriNet={(url: string) => {
				loadPetriNetFromUrl(url as AutomergeUrl);
			}}
			setTitle={(newTitle) => {
				changePetriNetDoc((petriNet) => {
					updateText(petriNet, ["title"], newTitle);
				});
			}}
			title={selectedPetriNetDoc.title}
		/>
	);
};
