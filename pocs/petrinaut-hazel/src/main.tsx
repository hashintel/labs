import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { CacheProvider } from "@emotion/react";
import { createEmotionCache, theme } from "@hashintel/design-system/theme";

import "./index.css";
import { App } from "./main/app";

const emotionCache = createEmotionCache();

// biome-ignore lint/style/noNonNullAssertion: we know it exists
ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<Suspense fallback={<div>Suspense fallback...</div>}>
			<CacheProvider value={emotionCache}>
				<ThemeProvider theme={theme}>
					<CssBaseline />
					<App />
				</ThemeProvider>
			</CacheProvider>
		</Suspense>
	</React.StrictMode>,
);
