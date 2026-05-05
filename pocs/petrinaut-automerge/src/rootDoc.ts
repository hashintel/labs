import type { AutomergeUrl, Repo } from "@automerge/react";

const ROOT_DOC_URL_KEY = "petrinaut-automerge-root-doc-url";

export type RootDocument = {
	petriNetUrls: AutomergeUrl[];
};

export const setRootDocUrl = (url: AutomergeUrl): void => {
	localStorage.setItem(ROOT_DOC_URL_KEY, url);
};

export const getOrCreateRoot = (repo: Repo): AutomergeUrl => {
	const existingId = localStorage.getItem(ROOT_DOC_URL_KEY);

	if (existingId) {
		return existingId as AutomergeUrl;
	}

	console.log("Creating repo...");

	const root = repo.create<RootDocument>({ petriNetUrls: [] });
	localStorage.setItem(ROOT_DOC_URL_KEY, root.url);
	return root.url;
};
