import {
	isValidAutomergeUrl,
	useDocument,
	useRepo,
	type AutomergeUrl,
} from "@automerge/react";
import { useHash } from "react-use";
import type { RootDocument } from "../rootDoc";
import { useCallback, useMemo, useState } from "react";
import {
	type PetriNet,
	PetrinautAutomergeWrapper,
} from "./app/petrinaut-automerge-wrapper";
import { defaultTokenTypes } from "@hashintel/petrinaut";

const createDefaultPetriNet = (): PetriNet => ({
	petriNetDefinition: {
		arcs: [],
		nodes: [],
		tokenTypes: JSON.parse(JSON.stringify(defaultTokenTypes)),
	},
	title: "New Petri Net",
});

export const AppAutomerge = ({ rootDocUrl }: { rootDocUrl: AutomergeUrl }) => {
	const [hash, setHash] = useHash();
	const cleanHash = hash.slice(1); // Remove the leading '#'
	const selectedDocUrl =
		cleanHash && isValidAutomergeUrl(cleanHash)
			? (cleanHash as AutomergeUrl)
			: undefined;

	const [hasAddedFirstNet, setHasAddedFirstNet] = useState(false);

	const repo = useRepo();

	console.log("Before useDocument in app.tsx, rootDocUrl", rootDocUrl);

	const [rootDoc, changeRootDoc] = useDocument<RootDocument>(rootDocUrl, {
		suspense: true,
	});

	console.log("loaded rootDoc in app.tsx", rootDoc);

	const petriNetUrls = useMemo(() => {
		return rootDoc?.petriNetUrls ?? [];
	}, [rootDoc]);

	const createAndSelectPetriNet = useCallback(
		(petriNet: PetriNet | null) => {
			const newPetriNet = repo.create<PetriNet>(
				petriNet ?? createDefaultPetriNet(),
			);

			changeRootDoc((rootDoc) => {
				rootDoc.petriNetUrls.push(newPetriNet.url);
			});

			setHash(newPetriNet.url);
		},
		[repo, changeRootDoc, setHash],
	);

	if (!selectedDocUrl) {
		console.log("No selected doc url");
		const firstOption = petriNetUrls[0];

		if (firstOption) {
			console.log("Setting hash to first option", firstOption);
			setHash(firstOption);
		} else if (!hasAddedFirstNet) {
			console.log("Creating new petri net");
			createAndSelectPetriNet(null);
			setHasAddedFirstNet(true);
		}
		return null;
	}

	return (
		<PetrinautAutomergeWrapper
			createAndSelectPetriNet={createAndSelectPetriNet}
			loadPetriNetFromUrl={(url) => {
				setHash(url);
			}}
			rootDoc={rootDoc}
			selectedPetriNetUrl={selectedDocUrl}
		/>
	);
};
