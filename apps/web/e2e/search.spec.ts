import { expect, type Page, test } from "@playwright/test";

const field = (page: Page) =>
	page.getByRole("textbox", { name: "Search events" });
const results = (page: Page) => page.locator(".sch-results");

const open = async (page: Page) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
};

test("slash focuses search; results group by day with Today marked", async ({
	page,
}) => {
	await open(page);
	await page.keyboard.press("/");
	await expect(field(page)).toBeFocused();
	await page.keyboard.type("standup");
	await expect(results(page).locator(".sch-results__day--today")).toHaveText(
		"Today",
	);
	await expect(
		results(page)
			.getByRole("button", { name: /Standup/ })
			.first(),
	).toBeVisible();
	await expect(page.getByText("Useful shortcuts")).toHaveCount(0);
});

test("no matches shows No results; Escape twice clears the search", async ({
	page,
}) => {
	await open(page);
	await page.keyboard.press("ControlOrMeta+f");
	await page.keyboard.type("zzqxv");
	await expect(results(page)).toHaveText("No results");
	await page.keyboard.press("Escape");
	await expect(field(page)).not.toBeFocused();
	await expect(field(page)).toHaveValue("zzqxv");
	await page.keyboard.press("Escape");
	await expect(field(page)).toHaveValue("");
	await expect(page.getByText("Useful shortcuts")).toBeVisible();
});

test("picking a result opens the event, and Search goes back", async ({
	page,
}) => {
	await open(page);
	await page.keyboard.press("/");
	await page.keyboard.type("design sync");
	await results(page)
		.getByRole("button", { name: /Design sync/ })
		.first()
		.click();
	await expect(
		page.locator("[data-event-panel]").getByLabel("Title"),
	).toHaveValue("Design sync");
	await expect(
		page.locator('.sch-chip[aria-selected="true"]', { hasText: "Design sync" }),
	).toHaveCount(1);
	await page.getByRole("button", { name: "Back to search" }).click();
	await expect(field(page)).toHaveValue("design sync");
	await expect(results(page)).toBeVisible();
});

test("the command menu offers to search for what was typed", async ({
	page,
}) => {
	await open(page);
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("standup");
	await page
		.getByRole("option", { name: "Search events for “standup”" })
		.click();
	await expect(field(page)).toHaveValue("standup");
	await expect(field(page)).toBeFocused();
});
