import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/** ICS feed subscriptions against a fake feed fetcher on the auth Worker. */
const AUTH = "http://localhost:8787";
const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ymd = (d: Date) =>
	`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const today = ymd(new Date());

const ROTA = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Test//EN",
	"X-WR-CALNAME:Team rota",
	"BEGIN:VEVENT",
	"UID:shift@example.com",
	"SUMMARY:Rota shift",
	`DTSTART:${today}T100000`,
	`DTEND:${today}T110000`,
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

async function fakeFeeds(context: BrowserContext) {
	const asked: string[] = [];
	await context.route(`${AUTH}/feed`, async (route) => {
		if (route.request().method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: cors });
		const { url } = route.request().postDataJSON() as { url: string };
		asked.push(url);
		if (url.includes("broken"))
			return route.fulfill({
				status: 502,
				headers: cors,
				json: { error: "unreachable" },
			});
		return route.fulfill({
			headers: cors,
			json: { status: 200, body: ROTA, etag: '"1"' },
		});
	});
	return { asked };
}

const chip = (page: Page, text: string) =>
	page.locator(".sch-chip[data-event-id]", { hasText: text });

async function command(page: Page, query: string) {
	await page.keyboard.press("ControlOrMeta+k");
	await page.keyboard.type(query);
	await page.keyboard.press("Enter");
}

test("subscribing to a feed shows its events, read-only, and unsubscribing removes them", async ({
	page,
	context,
}) => {
	const feeds = await fakeFeeds(context);
	await page.addInitScript(() => {
		window.__SCHEDEE_SCROLL_TOP__ = 8 * 48;
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(chip(page, "Standup").first()).toBeVisible();
	const sidebar = page.locator(".sch-sidebar");
	const input = page.getByRole("combobox", { name: "Command" });

	// Something that isn't a link keeps the prompt open.
	await command(page, "subscribe");
	await page.keyboard.type("not a link");
	await page.keyboard.press("Enter");
	await expect(input).toHaveAttribute("aria-invalid", "true");
	await input.fill("webcal://example.com/rota.ics");
	await page.keyboard.press("Enter");

	await expect(chip(page, "Rota shift")).toBeVisible();
	await expect(sidebar).toContainText("Subscriptions");
	await expect(sidebar).toContainText("Team rota");
	await expect(chip(page, "Standup")).toHaveCount(0);
	expect(feeds.asked).toEqual(["https://example.com/rota.ics"]);

	// A feed that can't be fetched says so on its row.
	await command(page, "subscribe");
	await page.keyboard.type("https://broken.example.com/cal.ics");
	await page.keyboard.press("Enter");
	await expect(
		sidebar.getByRole("img", { name: /Couldn't load this calendar/ }),
	).toBeVisible();

	// Both survive a reload.
	await page.reload();
	await page.locator("[data-schedee-ready]").waitFor();
	await expect(chip(page, "Rota shift")).toBeVisible();

	// Feed events can't be deleted here.
	await chip(page, "Rota shift").click();
	await page.keyboard.press("Backspace");
	await page.waitForTimeout(200);
	await expect(chip(page, "Rota shift")).toBeVisible();
	await page.keyboard.press("Escape");

	// Unsubscribing asks first, with Cancel on top.
	await command(page, "unsubscribe team rota");
	await expect(page.getByRole("option", { name: "Unsubscribe" })).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(chip(page, "Rota shift")).toBeVisible();
	await command(page, "unsubscribe team rota");
	await page.getByRole("option", { name: "Unsubscribe", exact: true }).click();
	await expect(chip(page, "Rota shift")).toHaveCount(0);
	await expect(sidebar).not.toContainText("Team rota");

	// With the last feed gone, the demo comes back.
	await command(page, "unsubscribe cal");
	await page.getByRole("option", { name: "Unsubscribe", exact: true }).click();
	await expect(sidebar).not.toContainText("Subscriptions");
	await expect(chip(page, "Standup").first()).toBeVisible();
});
