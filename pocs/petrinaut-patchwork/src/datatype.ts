import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { SDCPN } from "@hashintel/petrinaut";

export type Doc = {
	title: string;
	petriNetDefinition: SDCPN;
};

const defaultTitle = "Untitled Petri Net";

export const PetrinautDataType: DatatypeImplementation<Doc> = {
	setTitle: (doc, title) => {
		doc.title = title;
	},
	getTitle: (doc) => {
		return doc.title || "Untitled Petri Net";
	},
	init: (doc) => {
		doc.title = defaultTitle;
		doc.petriNetDefinition = {
			places: [],
			transitions: [],
			types: [],
			parameters: [],
			differentialEquations: [],
		};
	},
};
