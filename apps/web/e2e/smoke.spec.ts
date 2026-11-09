import { expect, test } from "@playwright/test";

test("app shell renders the current week", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Schedee" })).toBeVisible();
	await expect(page.getByTestId("week-range")).toHaveText(
		/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/,
	);
});
