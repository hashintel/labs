import type {
	PetriNetDefinitionObject,
	TokenCounts,
} from "@hashintel/petrinaut";
import { useCallback, useEffect, useState } from "react";

export type MessageToHazel =
	| { type: "ready"; id: string }
	| { type: "setSyntax"; id: string; codec: string; value: string }
	| { type: "resize"; id: string; width: number; height: number };

export type MessageFromHazel =
	| { type: "init"; id: string; value: string }
	| {
			type: "constraints";
			id: string;
			maxWidth: number;
			maxHeight: number;
			minWidth?: number;
			minHeight?: number;
	  };

export function isFromHazelMessage(data: unknown): data is MessageFromHazel {
	return (
		data !== null &&
		typeof data === "object" &&
		"type" in data &&
		"id" in data &&
		["init", "constraints"].includes(
			(data as Record<string, unknown>).type as string,
		) &&
		typeof (data as Record<string, unknown>).id === "string"
	);
}

type HazelIntegrationConfig = {
	id: string;
	codec: string;
	onInit: (value: string) => void;
};

export type HazelSimulationState = Array<
	Array<{ placeId: string; marking: TokenCounts; placeLabel: string }>
>;

export type HazelValue = {
	netDefinition: PetriNetDefinitionObject;
	simulationState: HazelSimulationState | undefined;
};

const sendToHazel = (message: MessageToHazel, targetOrigin: string) => {
	if (window.parent && window.parent !== window) {
		console.log("Sending message to Hazel", message);
		window.parent.postMessage(message, targetOrigin);
	}
};

/**
 * Core Hazel integration - handles protocol, messaging, and setup
 */
export const useHazelIntegration = (config: HazelIntegrationConfig) => {
	const { id, codec, onInit } = config;
	const [hasInit, setHasInit] = useState(false);

	const targetOrigin =
		new URLSearchParams(window.location.search).get("parentOrigin") || "*";

	const setSyntax = useCallback(
		(value: HazelValue) => {
			sendToHazel(
				{ type: "setSyntax", id, codec, value: JSON.stringify(value) },
				targetOrigin,
			);
		},
		[id, codec, targetOrigin],
	);

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const data = event.data;

			if (!isFromHazelMessage(data) || data.id !== id) {
				return;
			}

			console.log("Received message from Hazel", data);

			switch (data.type) {
				case "init":
					if (onInit) {
						onInit(data.value);
					}
					break;
			}
		};

		window.addEventListener("message", handleMessage);

		// Send ready message when component mounts
		if (!hasInit) {
			sendToHazel({ type: "ready", id }, targetOrigin);
			setHasInit(true);
		}

		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, [hasInit, id, onInit, targetOrigin]);

	return {
		setSyntax,
	};
};
