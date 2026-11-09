import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	use: { baseURL: "http://localhost:4173" },
	webServer: {
		command: "pnpm build && pnpm preview --port 4173 --strictPort",
		port: 4173,
		reuseExistingServer: false,
	},
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		{ name: "webkit", use: { browserName: "webkit" } },
	],
});
