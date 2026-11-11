import { defineConfig } from "@playwright/test";

/** Override with E2E_PORT when 4173 is taken. */
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
	testDir: "e2e",
	use: { baseURL: `http://localhost:${port}` },
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		port,
		reuseExistingServer: false,
	},
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		{ name: "webkit", use: { browserName: "webkit" } },
	],
});
