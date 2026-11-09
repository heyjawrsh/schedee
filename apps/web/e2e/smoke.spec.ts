import { expect, type Page, test } from "@playwright/test";

const open = async (page: Page) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
};
const columns = (page: Page) => page.locator(".sch-dayhead__cell");

test("renders the seeded week from local storage", async ({ page }) => {
	await open(page);
	await expect(page.getByText("Useful shortcuts")).toBeVisible();
	await expect(columns(page)).toHaveCount(7);
	await expect(page.locator(".sch-badge")).toHaveCount(1);
	await expect(page.locator(".sch-chip", { hasText: "Standup" })).toHaveCount(
		5,
	);
});

test("keyboard switches views and navigates", async ({ page }) => {
	await open(page);
	await page.keyboard.press("d");
	await expect(columns(page)).toHaveCount(1);
	await page.keyboard.press("3");
	await expect(columns(page)).toHaveCount(3);
	await page.keyboard.press("m");
	await expect(page.locator("[data-view=month]")).toBeVisible();
	await expect(page.locator(".sch-month__cell")).toHaveCount(42);
	await page.keyboard.press("w");
	const firstDay = await columns(page).first().textContent();
	await page.keyboard.press("j");
	await expect(columns(page).first()).not.toHaveText(firstDay ?? "");
	await page.keyboard.press("t");
	await expect(columns(page).first()).toHaveText(firstDay ?? "");
});

test("view menu and toolbar buttons work", async ({ page }) => {
	await open(page);
	await page.getByRole("button", { name: "Week" }).click();
	await page.getByRole("menuitem", { name: /Month/ }).click();
	await expect(page.locator("[data-view=month]")).toBeVisible();
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await page.getByRole("button", { name: "Today" }).click();
	await expect(page.locator(".sch-month__cell .sch-badge")).toHaveCount(1);
});

test("data survives a reload", async ({ page }) => {
	await open(page);
	await page.evaluate(async () => {
		const req = indexedDB.open("schedee");
		const db: IDBDatabase = await new Promise((r) => {
			req.onsuccess = () => r(req.result);
		});
		const tx = db.transaction("events", "readwrite");
		const today = new Date().toISOString().slice(0, 10);
		tx.objectStore("events").put({
			id: "e2e",
			calendarId: "personal",
			title: "Added by test",
			start: `${today}T07:00:00`,
			end: `${today}T08:00:00`,
			allDay: false,
		});
		await new Promise((r) => {
			tx.oncomplete = r;
		});
	});
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(page.getByText("Added by test")).toBeVisible();
});

for (const view of ["w", "m", "d"]) {
	test(`captures the ${view} view for visual review`, async ({
		page,
		browserName,
	}, info) => {
		await open(page);
		await page.keyboard.press(view);
		await page.screenshot({
			path: info.outputPath(`view-${view}-${browserName}.png`),
		});
	});
}
