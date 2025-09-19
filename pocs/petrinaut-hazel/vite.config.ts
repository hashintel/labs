// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	build: {
		target: "esnext",
	},

	plugins: [react()],
});
