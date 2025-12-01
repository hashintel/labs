import type { HasVersionControlMetadata } from "@patchwork/sdk/versionControl";
import { type DataTypeImplementation, initFrom } from "@patchwork/sdk";
import type { SDCPN } from "@hashintel/petrinaut";

export type Doc = HasVersionControlMetadata<unknown, unknown> & {
	title: string;
	petriNetDefinition: SDCPN;
};

export const markCopy = (doc: Doc) => {
	doc.title = `Copy of ${doc.title}`;
};

const setTitle = async (doc: Doc, title: string) => {
	doc.title = title;
};

const getTitle = async (doc: Doc) => {
	return doc.title || "Petrinaut";
};

export const init = (doc: Doc) => {
	initFrom(doc, {
		title: "Untitled Petri Net",
		petriNetDefinition: {
			places: [],
			transitions: [],
			types: [],
			parameters: [],
			differentialEquations: [],
		},
	});
};

export const dataType: DataTypeImplementation<Doc, unknown> = {
	init,
	getTitle,
	setTitle,
	markCopy,
};
