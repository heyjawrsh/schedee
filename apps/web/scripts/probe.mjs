// Print bounding boxes for selectors in the rendered app (debug aid for fidelity work).
//   node scripts/probe.mjs ".sch-col" ".sch-allday" ...
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { build, preview } from "vite";

const web = resolve(import.meta.dirname, "..");
const snap = resolve(web, "../../.re/fixtures/reference-week.json");
await build({ root: web, logLevel: "warn" });
const server = await preview({
	root: web,
	preview: { port: 4175, strictPort: true },
	logLevel: "warn",
});
const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
const page = await browser.newPage({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
});
await page.addInitScript(
	(s) => {
		window.__SCHEDEE_SNAPSHOT__ = s;
		window.__SCHEDEE_THEME__ = "light";
	},
	existsSync(snap) ? JSON.parse(readFileSync(snap, "utf8")) : null,
);
await page.goto("http://localhost:4175/");
await page.waitForSelector("[data-schedee-ready]");
for (const sel of process.argv.slice(2)) {
	const boxes = await page.$$eval(sel, (els) =>
		els.slice(0, 4).map((e) => {
			const r = e.getBoundingClientRect();
			return [r.x, r.y, r.width, r.height].map(
				(v) => Math.round(v * 100) / 100,
			);
		}),
	);
	console.log(sel, JSON.stringify(boxes));
}
await browser.close();
await new Promise((r) => server.httpServer.close(r));
