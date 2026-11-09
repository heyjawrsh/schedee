import { expect, type Page, test } from "@playwright/test";

const open = async (page: Page) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
};
const chip = (page: Page, text: string | RegExp) =>
	page.locator(".sch-chip[data-event-id]", { hasText: text });
const panel = (page: Page) => page.locator("[data-event-panel]");

/** Adds an event straight to IndexedDB, then reloads so the app picks it up. */
const insert = async (page: Page, event: Record<string, unknown>) => {
	await page.evaluate(async (e) => {
		const req = indexedDB.open("schedee");
		const db: IDBDatabase = await new Promise((r) => {
			req.onsuccess = () => r(req.result);
		});
		const tx = db.transaction("events", "readwrite");
		tx.objectStore("events").put(e);
		await new Promise((r) => {
			tx.oncomplete = r;
		});
		db.close();
	}, event);
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
};
const today = () => new Date().toLocaleDateString("en-CA");

test("selecting an event opens the editor; Escape closes it", async ({
	page,
}) => {
	await open(page);
	await chip(page, "Standup").first().click();
	await expect(panel(page)).toBeVisible();
	await expect(panel(page).getByLabel("Title")).toHaveValue("Standup");
	await expect(chip(page, "Standup").first()).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.keyboard.press("Escape");
	await expect(panel(page)).toHaveCount(0);
	await expect(page.getByText("Useful shortcuts")).toBeVisible();
});

test("renaming one occurrence of a series only changes that day, and persists", async ({
	page,
}) => {
	await open(page);
	await chip(page, "Standup").first().click();
	await expect(
		panel(page).getByRole("button", { name: "This event" }),
	).toHaveAttribute("aria-pressed", "true");
	const title = panel(page).getByLabel("Title");
	await title.fill("Standup (moved)");
	await title.press("Enter");
	await expect(chip(page, "Standup (moved)")).toHaveCount(1);
	await expect(chip(page, /^Standup10/)).toHaveCount(4);
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(chip(page, "Standup (moved)")).toHaveCount(1);
});

test("editing all events moves the whole series", async ({ page }) => {
	await open(page);
	await chip(page, "Check-in").first().click();
	await panel(page).getByRole("button", { name: "All events" }).click();
	const start = panel(page).getByLabel("Start");
	await start.fill("1pm");
	await start.press("Enter");
	await expect(chip(page, "Check-in").first()).toContainText("1 PM");
	await page.keyboard.press("m");
	await expect(
		page.locator(".sch-mitem", { hasText: "Check-in" }).first(),
	).toContainText("1 PM");
});

test("a single event keeps its length when the start moves, and can be deleted", async ({
	page,
}) => {
	await open(page);
	await insert(page, {
		id: "dentist",
		calendarId: "personal",
		title: "Dentist",
		start: `${today()}T07:00:00`,
		end: `${today()}T08:00:00`,
		allDay: false,
	});
	await chip(page, "Dentist").click();
	const start = panel(page).getByLabel("Start");
	await start.fill("6:30");
	await start.press("Enter");
	await expect(chip(page, "Dentist")).toContainText("6:30");
	await expect(panel(page).getByLabel("End")).toHaveValue(/7:30/);
	await panel(page).getByRole("button", { name: "More actions" }).click();
	await page
		.getByRole("menuitem", { name: "Delete event" })
		.click({ timeout: 4000 });
	await expect(chip(page, "Dentist")).toHaveCount(0);
	await expect(panel(page)).toHaveCount(0);
});

test("events on subscribed calendars are read-only", async ({ page }) => {
	await open(page);
	await insert(page, {
		id: "feed",
		calendarId: "birthdays",
		title: "From a feed",
		start: `${today()}T06:00:00`,
		end: `${today()}T06:30:00`,
		allDay: false,
		createdBy: "feed@example.com",
	});
	await chip(page, "From a feed").click();
	await expect(panel(page).getByLabel("Title")).toHaveAttribute("readonly", "");
	await expect(
		panel(page).getByRole("button", { name: "More actions" }),
	).toHaveCount(0);
	await expect(panel(page).getByText("feed@example.com")).toBeVisible();
});

test("captures the editor for visual review", async ({
	page,
	browserName,
}, info) => {
	await open(page);
	await chip(page, "Design sync").first().click();
	await expect(panel(page)).toBeVisible();
	await page.screenshot({ path: info.outputPath(`editor-${browserName}.png`) });
});
