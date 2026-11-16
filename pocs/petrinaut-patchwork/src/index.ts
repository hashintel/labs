import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
	{
		type: "patchwork:datatype",
		id: "petrinaut-petrinet",
		name: "Petrinaut Net",
		icon: "Network",
		async load() {
			const { PetrinautDataType } = await import("./datatype");
			return PetrinautDataType;
		},
	},

	{
		type: "patchwork:tool",
		id: "petrinaut",
		name: "Petrinaut",
		icon: "Network",
		supportedDatatypes: ["petrinaut-petrinet"],
		async load() {
			const { renderPetrinautEditor } = await import("./tool");
			return renderPetrinautEditor;
		},
	},
	{
		type: "patchwork:skill",
		id: "petrinaut-petrinet",
		name: "Petrinaut Net",
		description:
			"Creates and manages Petrinaut Petri Net documents with places and transitions.",
		async load() {
			return {
				documentation: (await import("./SKILL.md?raw")).default,
				api: (await import("./skill-api")).default,
			};
		},
	},
	{
		// Instruction pack for Patchwork's chat computer (the `llm:skill` type
		// the chat tool consumes): how to build and edit Petri nets with the
		// generic document tools. Auto-activates when a Petrinaut doc is
		// focused.
		type: "llm:skill",
		id: "petrinaut-petrinet",
		name: "Petrinaut Net",
		description:
			"Build and edit Petrinaut Petri nets — places, transitions, arcs, colours, parameters and their simulation code. Applies when the focused document is a Petrinaut net, or when the user asks to model a process as a Petri net.",
		datatypes: ["petrinaut-petrinet"],
		async load() {
			const { skill } = await import("./llm-skill");
			return skill;
		},
	},
];
