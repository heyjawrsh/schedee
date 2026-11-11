import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/**
 * Google sign-in and sync against a fake Google: the auth Worker and the Calendar API are both
 * intercepted, so this runs without credentials.
 */
const AUTH = "http://localhost:8787";
const API = "https://www.googleapis.com/calendar/v3";
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const atToday = (h: number, m = 0) => {
	const d = new Date();
	d.setHours(h, m, 0, 0);
	return d.toISOString();
};
const idToken = `x.${Buffer.from(JSON.stringify({ email: "ada@example.com", sub: "1" })).toString("base64url")}.y`;
const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/** Installs the fake. `title` is what the next events call returns for the test event. */
async function fakeGoogle(context: BrowserContext) {
	const calls: string[] = [];
	let title = "Kickoff";
	await context.route(`${AUTH}/oauth/google/**`, (route) => {
		if (route.request().method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: cors });
		calls.push(new URL(route.request().url()).pathname);
		return route.fulfill({
			headers: cors,
			json: {
				access_token: "fake-access",
				expires_in: 3600,
				refresh_token: "fake-refresh",
				id_token: idToken,
			},
		});
	});
	// Registered after the catch-all: Playwright tries the newest route first.
	await context.route(`${AUTH}/oauth/google/start**`, (route) => {
		const state = new URL(route.request().url()).searchParams.get("state");
		return route.fulfill({
			contentType: "text/html",
			body: `<script>window.opener.postMessage(${JSON.stringify({
				type: "schedee:oauth",
				provider: "google",
				code: "fake-code",
				state,
				error: null,
			})}, "*"); window.close();</script>`,
		});
	});
	await context.route(`${API}/**`, (route) => {
		const url = new URL(route.request().url());
		if (route.request().method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: cors });
		calls.push(
			`${url.pathname}${url.searchParams.has("syncToken") ? "?sync" : ""}`,
		);
		if (url.pathname.endsWith("/calendarList"))
			return route.fulfill({
				headers: cors,
				json: {
					items: [
						{
							id: "ada@example.com",
							summary: "ada@example.com",
							backgroundColor: "#4986e7",
							primary: true,
							accessRole: "owner",
						},
					],
				},
			});
		return route.fulfill({
			headers: cors,
			json: {
				timeZone: ZONE,
				nextSyncToken: "sync-1",
				items: [
					{
						id: "kickoff",
						summary: title,
						start: { dateTime: atToday(11), timeZone: ZONE },
						end: { dateTime: atToday(12), timeZone: ZONE },
					},
				],
			},
		});
	});
	return {
		calls,
		rename: (t: string) => {
			title = t;
		},
	};
}

const chip = (page: Page, text: string) =>
	page.locator(".sch-chip[data-event-id]", { hasText: text });

test("adding a Google account swaps the demo for the synced calendar", async ({
	page,
	context,
}) => {
	const google = await fakeGoogle(context);
	await page.addInitScript(() => {
		window.__SCHEDEE_SCROLL_TOP__ = 8 * 48;
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(chip(page, "Standup").first()).toBeVisible();

	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("google");
	await page.keyboard.press("Enter");

	await expect(chip(page, "Kickoff")).toBeVisible();
	await expect(chip(page, "Standup")).toHaveCount(0);
	await expect(page.locator(".sch-sidebar, aside").first()).toContainText(
		"ada@example.com",
	);
	expect(google.calls).toContain("/oauth/google/token");

	// Coming back to the window pulls changes with the saved sync token.
	google.rename("Kickoff (moved room)");
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(chip(page, "Kickoff (moved room)")).toBeVisible();
	expect(google.calls.some((c) => c.endsWith("/events?sync"))).toBe(true);

	// And it survives a reload without signing in again.
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(chip(page, "Kickoff (moved room)")).toBeVisible();
});
