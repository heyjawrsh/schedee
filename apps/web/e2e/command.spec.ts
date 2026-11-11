import { expect, type Page, test } from "@playwright/test";

const menu = (page: Page) => page.getByRole("dialog", { name: "Command menu" });
const input = (page: Page) => menu(page).getByRole("combobox");
const option = (page: Page, name: string | RegExp) =>
	menu(page).getByRole("option", { name });

const open = async (page: Page) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
};

test("Cmd-K opens the menu with the first command active; Escape closes it", async ({
	page,
}) => {
	await open(page);
	await page.keyboard.press("ControlOrMeta+k");
	await expect(input(page)).toBeFocused();
	await expect(option(page, /Create event/)).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.keyboard.press("ArrowDown");
	await expect(option(page, /Go to date/)).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.keyboard.press("Escape");
	await expect(menu(page)).toHaveCount(0);
});

test("typing filters, and Enter runs the active command", async ({ page }) => {
	await open(page);
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("month view");
	await expect(option(page, "Display month view")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(option(page, /Search events for/)).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(menu(page)).toHaveCount(0);
	await expect(page.locator("[data-view]")).toHaveAttribute(
		"data-view",
		"month",
	);
});

test("the period key opens Go to date", async ({ page }) => {
	await open(page);
	await page.keyboard.press(".");
	await expect(input(page)).toHaveAttribute("placeholder", /Type a date/);
	await page.keyboard.type("nonsense");
	await page.keyboard.press("Enter");
	await expect(input(page)).toHaveAttribute("aria-invalid", "true");
	await input(page).fill("Dec 25");
	await page.keyboard.press("Enter");
	await expect(menu(page)).toHaveCount(0);
	await expect(page.locator(".sch-title__month")).toContainText("December");
});

test("hiding a calendar from the menu removes its events", async ({ page }) => {
	await open(page);
	const standup = page.locator(".sch-chip[data-event-id]", {
		hasText: "Standup",
	});
	await expect(standup.first()).toBeVisible();
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("hide team");
	await page.keyboard.press("Enter");
	await expect(standup).toHaveCount(0);
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("show team");
	await page.keyboard.press("Enter");
	await expect(standup.first()).toBeVisible();
});

test("Set theme opens a sub-list and the choice survives a reload", async ({
	page,
}) => {
	await open(page);
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("theme");
	await page.keyboard.press("Enter");
	await expect(option(page, "Dark")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(input(page)).toHaveValue("theme");
	await expect(option(page, /Set theme/)).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.keyboard.press("Enter");
	await option(page, "Light").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type("theme");
	await page.keyboard.press("Enter");
	await option(page, "Dark").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("C creates an event and puts the cursor in its title", async ({
	page,
}) => {
	await open(page);
	await page.keyboard.press("c");
	await expect(
		page.locator("[data-event-panel]").getByLabel("Title"),
	).toBeFocused();
});
