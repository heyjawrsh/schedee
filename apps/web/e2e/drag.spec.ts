import { expect, type Page, test } from "@playwright/test";

const HOUR = 48;
const today = () => new Date().toLocaleDateString("en-CA");
/** Mon = 0 … Sun = 6, matching the week view's columns. */
const todayCol = () => (new Date().getDay() + 6) % 7;

const chip = (page: Page, text: string | RegExp) =>
	page.locator(".sch-chip[data-event-id]", { hasText: text });
const panel = (page: Page) => page.locator("[data-event-panel]");

/** Opens the app scrolled to 6 AM, with one test event at 9–10 AM today. */
const open = async (page: Page, extra: Record<string, unknown> = {}) => {
	await page.addInitScript(() => {
		window.__SCHEDEE_SCROLL_TOP__ = 6 * 48;
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
	await page.evaluate(
		async (e) => {
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
		},
		{
			id: "dragme",
			calendarId: "personal",
			title: "Drag me",
			start: `${today()}T09:00:00`,
			end: `${today()}T10:00:00`,
			allDay: false,
			...extra,
		},
	);
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
};

/** Presses at a point inside `box`, moves by (dx, dy) in steps, and releases unless told not to. */
const dragBy = async (
	page: Page,
	from: { x: number; y: number },
	dx: number,
	dy: number,
	{ alt = false, release = true } = {},
) => {
	if (alt) await page.keyboard.down("Alt");
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
	await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
	if (release) await page.mouse.up();
	if (alt) await page.keyboard.up("Alt");
};

const middle = async (page: Page, text: string) => {
	const b = await chip(page, text).boundingBox();
	if (!b) throw new Error(`no chip ${text}`);
	return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};

test("dragging an event moves it, and undo puts it back", async ({ page }) => {
	await open(page);
	const m = await middle(page, "Drag me");
	await dragBy(page, m, 0, HOUR * 2);
	await expect(chip(page, "Drag me")).toContainText("11 AM – 12 PM");
	await expect(panel(page).getByLabel("Start")).toHaveValue(/11/);
	await page.keyboard.press("ControlOrMeta+z");
	await expect(chip(page, "Drag me")).toContainText("9 – 10");
	await page.keyboard.press("ControlOrMeta+Shift+z");
	await expect(chip(page, "Drag me")).toContainText("11 AM – 12 PM");
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(chip(page, "Drag me")).toContainText("11 AM – 12 PM");
});

test("dragging to another day keeps the time", async ({ page }) => {
	await open(page);
	const m = await middle(page, "Drag me");
	const dir = todayCol() === 6 ? -1 : 1;
	await dragBy(page, m, dir * (m.box.width + 13), 0);
	const moved = await chip(page, "Drag me").boundingBox();
	expect(Math.sign((moved?.x ?? 0) - m.box.x)).toBe(dir);
	await expect(chip(page, "Drag me")).toContainText("9 – 10");
});

test("the drag preview shows the ghost, the copy and the slot ring; Escape cancels", async ({
	page,
}) => {
	await open(page);
	const m = await middle(page, "Drag me");
	await dragBy(page, m, 0, HOUR, { release: false });
	await expect(page.locator(".sch-chip--ghost")).toHaveCount(1);
	await expect(page.locator(".sch-chip--drag")).toContainText("10 – 11");
	await expect(page.locator(".sch-dropring")).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(page.locator(".sch-chip--drag")).toHaveCount(0);
	await page.mouse.up();
	await expect(chip(page, "Drag me")).toContainText("9 – 10");
	await expect(panel(page)).toBeVisible();
});

test("dragging the bottom edge resizes", async ({ page }) => {
	await open(page);
	const { box } = await middle(page, "Drag me");
	await dragBy(
		page,
		{ x: box.x + box.width / 2, y: box.y + box.height - 2 },
		0,
		HOUR / 2,
	);
	await expect(chip(page, "Drag me")).toContainText("9 – 10:30");
});

test("Option-drag duplicates and leaves the original", async ({ page }) => {
	await open(page);
	const m = await middle(page, "Drag me");
	await dragBy(page, m, 0, HOUR * 3, { alt: true });
	await expect(chip(page, "Drag me")).toHaveCount(2);
	await expect(chip(page, "Drag me").filter({ hasText: "12 – 1" })).toHaveCount(
		1,
	);
	await page.keyboard.press("ControlOrMeta+z");
	await expect(chip(page, "Drag me")).toHaveCount(1);
});

test("Cmd-D duplicates the selected event in place", async ({ page }) => {
	await open(page);
	await chip(page, "Drag me").click();
	await page.keyboard.press("ControlOrMeta+d");
	await expect(chip(page, "Drag me")).toHaveCount(2);
});

test("Backspace deletes the selected event, and undo restores it", async ({
	page,
}) => {
	await open(page);
	await chip(page, "Drag me").click();
	await page.keyboard.press("Backspace");
	await expect(chip(page, "Drag me")).toHaveCount(0);
	await expect(panel(page)).toHaveCount(0);
	await page.keyboard.press("ControlOrMeta+z");
	await expect(chip(page, "Drag me")).toHaveCount(1);
});

test("dragging on empty grid creates an event and focuses its title", async ({
	page,
}) => {
	await open(page);
	const m = await middle(page, "Drag me");
	// Six hours below the test event, same day: 3 PM.
	const x = m.box.x + m.box.width + 6; // the column's right margin, clear of chips
	await dragBy(page, { x, y: m.box.y + HOUR * 6 + 4 }, 0, HOUR - 8);
	await expect(panel(page).getByLabel("Title")).toBeFocused();
	await page.keyboard.type("Zebra sync");
	await page.keyboard.press("Enter");
	await expect(chip(page, "Zebra sync")).toContainText("3 – 4");
});

test("double-clicking empty grid creates a one-hour event", async ({
	page,
}) => {
	await open(page);
	const m = await middle(page, "Drag me");
	await page.mouse.dblclick(m.box.x + m.box.width + 6, m.box.y + HOUR * 4 + 4);
	await expect(chip(page, "(No title)")).toContainText("1 – 2");
});

test("events on subscribed calendars do not move", async ({ page }) => {
	await open(page, { calendarId: "birthdays" });
	const m = await middle(page, "Drag me");
	await expect(chip(page, "Drag me").locator(".sch-chip__handle")).toHaveCount(
		0,
	);
	await dragBy(page, m, 0, HOUR * 2);
	await expect(chip(page, "Drag me")).toContainText("9 – 10");
});
