import {
	type AutomergeUrl,
	isValidAutomergeUrl,
	useDocument,
	useRepo,
} from "@automerge/react";
import { defaultTokenTypes } from "./vendor/petrinaut";
import {
	PetrinautPatchworkTool,
	type PetriNetDoc,
} from "./app-patchwork/petrinaut-patchwork-tool";
import type { PetriNet } from "./app-automerge/petrinaut-automerge-wrapper";
import { useState, useMemo, useCallback } from "react";
import { useHash } from "react-use";
import type { RootDocument } from "../rootDoc";

const init = (): PetriNetDoc => {
	return {
		petriNetDefinition: {
			nodes: [],
			arcs: [],
			tokenTypes: structuredClone(defaultTokenTypes),
		},
		title: "Untitled Petri Net",
	};
};

/**
 * An app to mimic the behavior of Patchwork (as I currently understand it) loading a tool,
 * i.e. providing an AutomergeUrl which refers to a valid document for that tool.
 */
export const AppPatchwork = ({
	rootDocUrl,
}: {
	rootDocUrl: AutomergeUrl;
}) => {
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
			const newPetriNet = repo.create<PetriNet>(petriNet ?? init());

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

	return <PetrinautPatchworkTool docUrl={selectedDocUrl} />;
};
