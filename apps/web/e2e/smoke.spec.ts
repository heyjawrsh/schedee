import { expect, test } from "@playwright/test";

test("renders the demo week", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await expect(page.locator("[data-schedee-ready]")).toBeVisible();
	await expect(page.getByText("Useful shortcuts")).toBeVisible();
	await expect(page.locator(".sch-dayhead__cell")).toHaveCount(7);
	await expect(page.locator(".sch-badge")).toHaveCount(1);
	await expect(
		page.getByText("Quarterly planning with the platform group"),
	).toBeVisible();
});

test("captures the demo for visual review", async ({ page, browserName }, info) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
	await page.screenshot({ path: info.outputPath(`demo-${browserName}.png`) });
});
