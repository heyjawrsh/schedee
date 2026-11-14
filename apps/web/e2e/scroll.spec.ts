import { expect, test } from "@playwright/test";

test("the time grid scrolls to any hour", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
	const grid = page.locator(".sch-grid");
	const hour = (label: string) =>
		page.locator(".sch-hour", { hasText: new RegExp(`^${label}$`) });

	await grid.hover();
	await page.mouse.wheel(0, -2000);
	await expect.poll(() => grid.evaluate((g) => g.scrollTop)).toBe(0);
	await expect(hour("1AM")).toBeInViewport();

	await page.mouse.wheel(0, 2000);
	await expect
		.poll(() => grid.evaluate((g) => g.scrollTop + g.clientHeight))
		.toBe(1152);
	await expect(hour("11PM")).toBeInViewport();
});
