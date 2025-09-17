import { useState } from "react";
import {
	Petrinaut,
	defaultTokenTypes,
	type PetriNetDefinitionObject,
} from "@hashintel/petrinaut";
import { useHazelIntegration } from "./app/use-hazel-integration";
import { produce } from "immer";

const createDefaultNetDefinition = (): PetriNetDefinitionObject => {
	return {
		nodes: [],
		arcs: [],
		tokenTypes: structuredClone(defaultTokenTypes),
	};
};

/**
 * An incomplete type guard to check if a value is a valid Petri net definition.
 * Does not check the content of arrays.
 */
const isValidNetDefinition = (
	definition: unknown,
): definition is PetriNetDefinitionObject => {
	if (typeof definition !== "object" || definition === null) {
		return false;
	}

	if (!("nodes" in definition) || !Array.isArray(definition.nodes)) {
		return false;
	}

	if (!("arcs" in definition) || !Array.isArray(definition.arcs)) {
		return false;
	}

	if (!("tokenTypes" in definition) || !Array.isArray(definition.tokenTypes)) {
		return false;
	}

	return true;
};

/**
 * Wraps Petrinaut with the event handlers necessary for a Hazel Livelit.
 */
export const App = () => {
	const urlParams = new URLSearchParams(window.location.search);
	const id = urlParams.get("id") || "local-demo";

	const [netDefinition, setNetDefinition] =
		useState<PetriNetDefinitionObject | null>(null);

	const { setSyntax } = useHazelIntegration({
		id,
		codec: "json",
		onInit: (value) => {
			console.log("Received value", value);

			try {
				const parsedValue = JSON.parse(value);

				if (isValidNetDefinition(parsedValue)) {
					setNetDefinition(parsedValue);
				} else {
					console.error("Invalid net definition", parsedValue);
					const defaultNetDefinition = createDefaultNetDefinition();
					setNetDefinition(defaultNetDefinition);
					setSyntax(JSON.stringify(defaultNetDefinition));
				}
			} catch (error) {
				console.error("Error parsing net definition as JSON", error);
			}
		},
	});

	if (!netDefinition) {
		return null;
	}

	return (
		<Petrinaut
			key={id}
			hideNetManagementControls
			petriNetId={id}
			petriNetDefinition={netDefinition}
			existingNets={[]}
			mutatePetriNetDefinition={(definitionMutationFn) => {
				setNetDefinition((existingDefinition) => {
					const newDefinition = produce(
						existingDefinition,
						definitionMutationFn,
					);

					setSyntax(JSON.stringify(newDefinition));

					return newDefinition;
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
