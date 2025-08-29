import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import {
	Repo,
	BroadcastChannelNetworkAdapter,
	WebSocketClientAdapter,
	IndexedDBStorageAdapter,
	RepoContext,
	type DocHandle,
} from "@automerge/react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { CacheProvider } from "@emotion/react";
import { createEmotionCache, theme } from "@hashintel/design-system/theme";

import "./index.css";

import { getOrCreateRoot, type RootDocument } from "./rootDoc.ts";
import { AppPatchwork } from "./main/app-patchwork.tsx";

const repo = new Repo({
	network: [
		new BroadcastChannelNetworkAdapter(),
		new WebSocketClientAdapter("wss://sync.automerge.org"),
	],
	storage: new IndexedDBStorageAdapter(),
});

// Add the repo to the global window object so it can be accessed in the browser console
// This is useful for debugging and testing purposes.
declare global {
	interface Window {
		repo: Repo;
		// We also add the handle to the global window object for debugging
		handle: DocHandle<RootDocument>;
	}
}
window.repo = repo;

const emotionCache = createEmotionCache();

// Depending if we have an AutomergeUrl, either find or create the document
const rootDocUrl = getOrCreateRoot(repo);
window.handle = await repo.find(rootDocUrl);

// biome-ignore lint/style/noNonNullAssertion: we know it exists
ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<Suspense fallback={<div>Suspense fallback...</div>}>
			<RepoContext.Provider value={repo}>
				<CacheProvider value={emotionCache}>
					<ThemeProvider theme={theme}>
						<CssBaseline />
						{/* <AppAutomerge rootDocUrl={window.handle.url} /> */}
						<AppPatchwork rootDocUrl={window.handle.url} />
					</ThemeProvider>
				</CacheProvider>
			</RepoContext.Provider>
		</Suspense>
	</React.StrictMode>,
);
