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

type FakeEvent = Record<string, unknown> & {
	id: string;
	start?: GoogleTime | undefined;
	end?: GoogleTime | undefined;
};
type GoogleTime = { dateTime?: string; timeZone?: string };
/** Google answers with offsets; our writes send wall-clock time plus a zone (this machine's). */
const withOffset = (t?: GoogleTime) =>
	t?.dateTime && !/(Z|[+-]\d\d:\d\d)$/.test(t.dateTime)
		? { ...t, dateTime: new Date(t.dateTime).toISOString() }
		: t;

/** Installs a fake Google that keeps the events it's sent. */
async function fakeGoogle(context: BrowserContext) {
	const calls: string[] = [];
	const writes: { method: string; path: string; body?: FakeEvent }[] = [];
	const events = new Map<string, FakeEvent>([
		[
			"kickoff",
			{
				id: "kickoff",
				summary: "Kickoff",
				start: { dateTime: atToday(11), timeZone: ZONE },
				end: { dateTime: atToday(12), timeZone: ZONE },
			},
		],
	]);
	let offline = false;
	/** The user revoked our access: refreshes fail and old tokens stop working. */
	let revoked = false;
	/** Google refuses every write. */
	let refusing = false;
	await context.route(`${AUTH}/oauth/google/**`, (route) => {
		if (route.request().method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: cors });
		const path = new URL(route.request().url()).pathname;
		calls.push(path);
		if (revoked && path.endsWith("/refresh"))
			return route.fulfill({
				status: 400,
				headers: cors,
				json: { error: "invalid_grant" },
			});
		// A fresh sign-in is a new grant.
		if (path.endsWith("/token")) revoked = false;
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
		const req = route.request();
		const url = new URL(req.url());
		const method = req.method();
		if (method === "OPTIONS")
			return route.fulfill({ status: 204, headers: cors });
		if (offline) return route.abort("internetdisconnected");
		if (revoked)
			return route.fulfill({ status: 401, headers: cors, body: "revoked" });
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
		if (method !== "GET" && refusing)
			return route.fulfill({ status: 400, headers: cors, body: "invalid" });
		if (method !== "GET") {
			const body = req.postDataJSON() as FakeEvent | undefined;
			const path = url.pathname.replace(/^.*\/calendars\//, "/");
			writes.push({ method, path, ...(body ? { body } : {}) });
			const id =
				method === "POST" ? (body?.id ?? "") : (path.split("/").pop() ?? "");
			const next: FakeEvent =
				method === "DELETE"
					? { id, status: "cancelled" }
					: { ...events.get(id), ...body, id };
			next.start = withOffset(next.start);
			next.end = withOffset(next.end);
			events.set(id, next);
			return method === "DELETE"
				? route.fulfill({ status: 204, headers: cors, body: "" })
				: route.fulfill({ headers: cors, json: next });
		}
		return route.fulfill({
			headers: cors,
			json: {
				timeZone: ZONE,
				nextSyncToken: "sync-1",
				items: [...events.values()],
			},
		});
	});
	return {
		calls,
		writes,
		rename: (t: string) => {
			const e = events.get("kickoff");
			if (e) e.summary = t;
		},
		setOffline: (v: boolean) => {
			offline = v;
		},
		revoke: () => {
			revoked = true;
		},
		refuse: (v: boolean) => {
			refusing = v;
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

test("edits go to Google, and wait out a lost connection", async ({
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
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("google");
	await page.keyboard.press("Enter");
	await expect(chip(page, "Kickoff")).toBeVisible();

	// Dragging an hour later patches just the times.
	const b = await chip(page, "Kickoff").boundingBox();
	if (!b) throw new Error("no chip");
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 24, {
		steps: 4,
	});
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 48, {
		steps: 4,
	});
	await page.mouse.up();
	await expect
		.poll(() => google.writes.map((w) => `${w.method} ${w.path}`))
		.toEqual(["PATCH /ada%40example.com/events/kickoff"]);
	expect(Object.keys(google.writes[0]?.body ?? {}).sort()).toEqual([
		"end",
		"start",
	]);
	expect(google.writes[0]?.body?.start?.dateTime).toMatch(/T12:00:00$/);
	// Google's echo keeps the new time.
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(chip(page, "Kickoff")).toContainText("12 – 1 PM");

	// Deleting the selected event deletes it in Google too.
	await page.keyboard.press("Backspace");
	await expect(chip(page, "Kickoff")).toHaveCount(0);
	await expect.poll(() => google.writes.at(-1)?.method).toBe("DELETE");
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(chip(page, "Kickoff")).toHaveCount(0);

	// Offline, a new event waits in the queue; back online, it goes out in order.
	google.setOffline(true);
	await page.keyboard.press("c");
	await expect(
		page.locator("[data-event-panel]").getByLabel("Title"),
	).toBeFocused();
	await page.keyboard.type("Offline plan");
	await page.keyboard.press("Enter");
	await expect(chip(page, "Offline plan")).toBeVisible();
	await page.waitForTimeout(300);
	expect(google.writes.filter((w) => w.method !== "DELETE")).toHaveLength(1);
	google.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect
		.poll(() => google.writes.slice(2).map((w) => w.method))
		.toEqual(["POST", "PATCH"]);
	const [insert, rename] = google.writes.slice(2);
	expect(insert?.body?.id).toMatch(/^[0-9a-f]{32}$/);
	expect(rename?.path).toBe(`/ada%40example.com/events/${insert?.body?.id}`);
	expect(rename?.body).toEqual({ summary: "Offline plan" });
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(chip(page, "Offline plan")).toBeVisible();
});

test("a revoked sign-in asks to sign in again, and a refused edit says so", async ({
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
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("google");
	await page.keyboard.press("Enter");
	await expect(chip(page, "Kickoff")).toBeVisible();
	const sidebar = page.locator(".sch-sidebar");

	// Google turns us away: the account says so and offers to sign in again.
	google.revoke();
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	const again = sidebar.getByRole("button", { name: "Sign in again" });
	await expect(again).toBeVisible();
	await expect(sidebar.getByRole("img", { name: /Signed out/ })).toBeVisible();
	// The calendar stays on screen meanwhile.
	await expect(chip(page, "Kickoff")).toBeVisible();

	// The command menu offers the same.
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("sign in again");
	await expect(
		page.getByText("Sign in again: ada@example.com", { exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	await again.click();
	await expect(again).toHaveCount(0);
	await expect(sidebar.getByRole("img", { name: /Signed out/ })).toHaveCount(0);
	await expect(chip(page, "Kickoff")).toBeVisible();

	// Google refuses an edit for good: one quiet notice, until dismissed.
	google.refuse(true);
	await chip(page, "Kickoff").click();
	await page.keyboard.press("Backspace");
	const notice = sidebar.getByRole("status");
	await expect(notice).toHaveText("1 change wasn't saved");
	google.refuse(false);
	await notice.getByRole("button", { name: "Dismiss" }).click();
	await expect(notice).toHaveCount(0);
	// The calendar went back to what Google has.
	await expect(chip(page, "Kickoff")).toBeVisible();
});
