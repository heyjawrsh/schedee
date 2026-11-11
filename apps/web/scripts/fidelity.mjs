// Fidelity check: render the week view and diff it against a reference capture, region by region.
//
//   node scripts/fidelity.mjs [--theme light|dark] [--snapshot path.json] [--reference path.png] [--out dir]
//
// Defaults read from the gitignored .re/ folder (private reference captures). Without them the
// script still renders the public demo snapshot so the pipeline itself can be checked.
// References must already be sRGB (see docs/re/README.md); Chromium renders with
// --force-color-profile=srgb so both sides share one color space.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { build, preview } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const repo = resolve(web, "../..");
const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : fallback;
};
const theme = arg("theme", "light");
const themed = resolve(repo, `.re/fixtures/reference-week-${theme}.json`);
const snapshotPath = arg(
	"snapshot",
	existsSync(themed)
		? themed
		: resolve(repo, ".re/fixtures/reference-week.json"),
);
// The dark reference was captured with the grid scrolled further down.
const scrollTop = arg("scroll", theme === "dark" ? "112.5" : undefined);
const referencePath = arg(
	"reference",
	resolve(repo, `.re/reference/week-${theme}.srgb.png`),
);
const outDir = arg("out", resolve(repo, ".re/fidelity"));
// Optional: preselect an event (opens the editor) and limit the report to some regions.
const select = arg("select", undefined);
// Optional: a key to press once the app is ready, e.g. "Meta+k" for the command menu.
const press = arg("press", undefined);
const only = arg("regions", undefined)?.split(",");
const label = arg("label", `week-${theme}`);
mkdirSync(outDir, { recursive: true });

// Regions in CSS px at 1440x900, from docs/re/tokens.md section 3.
const REGIONS = {
	sidebar: [0, 0, 240, 900],
	toolbar: [240, 0, 916, 42],
	title: [240, 42, 916, 36],
	dayHeader: [240, 78, 916, 28],
	allDay: [240, 106, 916, 138],
	gutter: [240, 244, 72, 656],
	grid: [312, 244, 844, 656],
	contextPanel: [1156, 0, 284, 900],
	// The editor's upper block: header, title, times, people, calendar (dark reference).
	editor: [1156, 60, 284, 340],
	// The command menu's input row and footer (dark reference). Its rows hold commands Schedee
	// doesn't have (scheduling, Notion), so the list itself is compared by eye.
	cmdkInput: [380, 200, 680, 48],
	cmdkFooter: [380, 656, 680, 34],
};
// Regions that only mean something for a specific state; reported only when asked for.
const OPT_IN = ["editor", "cmdkInput", "cmdkFooter"];
// Areas that legitimately differ: the account avatar photo, and the macOS overlay scrollbar
// the reference machine draws on the calendar list (system chrome, not app UI).
const MASKS = [
	[893, 10, 26, 26],
	[226, 360, 12, 496],
];

await build({ root: web, logLevel: "warn" });
const server = await preview({
	root: web,
	preview: { port: 4174, strictPort: true },
	logLevel: "warn",
});
// Native 2x (not emulated) so layout snaps in device pixels, as on the Retina machine the
// reference came from. Emulated DSF snaps half-pixel positions in CSS px.
const browser = await chromium.launch({
	args: [
		"--force-color-profile=srgb",
		"--force-device-scale-factor=2",
		"--window-size=1440,900",
	],
});
try {
	const page = await browser.newPage({ viewport: null, colorScheme: theme });
	const metrics = await page.evaluate(() => [
		innerWidth,
		innerHeight,
		devicePixelRatio,
	]);
	if (metrics.join() !== "1440,900,2")
		throw new Error(`expected 1440x900@2, got ${metrics}`);
	const snapshot = existsSync(snapshotPath)
		? JSON.parse(readFileSync(snapshotPath, "utf8"))
		: null;
	await page.addInitScript(
		([s, t, top, sel]) => {
			window.__SCHEDEE_SNAPSHOT__ = s;
			window.__SCHEDEE_THEME__ = t;
			if (top !== null) window.__SCHEDEE_SCROLL_TOP__ = Number(top);
			if (sel !== null) window.__SCHEDEE_SELECT__ = sel;
		},
		[snapshot, theme, scrollTop ?? null, select ?? null],
	);
	await page.goto("http://localhost:4174/");
	await page.waitForSelector("[data-schedee-ready]");
	if (press) {
		await page.keyboard.press(press);
		await page.waitForTimeout(100);
	}
	const shotPath = resolve(outDir, `${label}.png`);
	await page.screenshot({ path: shotPath, scale: "device" });

	if (!existsSync(referencePath)) {
		console.log(
			`rendered ${shotPath}; no reference at ${referencePath}, skipping diff`,
		);
		process.exit(0);
	}
	const a = PNG.sync.read(readFileSync(shotPath));
	const b = PNG.sync.read(readFileSync(referencePath));
	if (a.width !== b.width || a.height !== b.height)
		throw new Error(
			`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`,
		);
	const S = 2;
	for (const [x, y, w, h] of MASKS) {
		for (let yy = y * S; yy < (y + h) * S; yy++)
			for (let xx = x * S; xx < (x + w) * S; xx++) {
				const i = (yy * a.width + xx) * 4;
				for (let k = 0; k < 4; k++) a.data[i + k] = b.data[i + k];
			}
	}
	const diff = new PNG({ width: a.width, height: a.height });
	const total = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
		threshold: 0.1,
		includeAA: false,
	});
	writeFileSync(
		resolve(outDir, `week-${theme}.diff.png`),
		PNG.sync.write(diff),
	);

	const report = {
		theme,
		totalMismatchPct: +((100 * total) / (a.width * a.height)).toFixed(3),
		regions: {},
	};
	for (const [name, [x, y, w, h]] of Object.entries(REGIONS).filter(([n]) =>
		only ? only.includes(n) : !OPT_IN.includes(n),
	)) {
		let bad = 0;
		for (let yy = Math.round(y * S); yy < Math.round((y + h) * S); yy++)
			for (let xx = Math.round(x * S); xx < Math.round((x + w) * S); xx++) {
				const i = (yy * a.width + xx) * 4;
				if (
					diff.data[i] === 255 &&
					diff.data[i + 1] === 0 &&
					diff.data[i + 2] === 0
				)
					bad++;
			}
		report.regions[name] = +((100 * bad) / (w * h * S * S)).toFixed(3);
	}
	writeFileSync(
		resolve(outDir, `week-${theme}.report.json`),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report));
} finally {
	await browser.close();
	await new Promise((r) => server.httpServer.close(r));
}
