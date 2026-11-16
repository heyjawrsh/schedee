import { expect, test } from "@playwright/test";

test("the time grid scrolls to any hour", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
	const grid = page.locator(".sch-grid");
	const hour = (label: string) =>
		page.locator(".sch-hour", { hasText: new RegExp(`^${label}$`) });

	// Chromium can drop a wheel event, so keep scrolling until the end is reached.
	const scroll = async (dy: number) => {
		await grid.hover();
		await page.mouse.wheel(0, dy);
		return grid.evaluate((g) => [g.scrollTop, g.scrollTop + g.clientHeight]);
	};
	await expect.poll(async () => (await scroll(-2000))[0]).toBe(0);
	await expect(hour("1AM")).toBeInViewport();

	await expect.poll(async () => (await scroll(2000))[1]).toBe(1152);
	await expect(hour("11PM")).toBeInViewport();
});
