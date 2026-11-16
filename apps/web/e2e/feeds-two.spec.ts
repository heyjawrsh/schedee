import { expect, test } from "@playwright/test";

/** Two private-style links on one host, each with its own calendar. */

const AUTH = "http://localhost:8787";
const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ymd = (d: Date) =>
	`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const today = ymd(new Date());
const cal = (name: string, title: string) =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`X-WR-CALNAME:${name}`,
		"BEGIN:VEVENT",
		`UID:${title}@example.com`,
		`SUMMARY:${title}`,
		`DTSTART:${today}T100000`,
		`DTEND:${today}T110000`,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

const A =
	"https://cal.example.com/api/calendar/v1/url/AAAA/calendar.ics?CacheKey=1&PassphraseKey=aa";
const B =
	"https://cal.example.com/api/calendar/v1/url/BBBB/calendar.ics?CacheKey=2&PassphraseKey=bb";

test("two feeds from one host keep their own names and events", async ({
	page,
	context,
}) => {
	const asked: string[] = [];
	await context.route(`${AUTH}/feed`, async (route) => {
		if (route.request().method() === "OPTIONS")
			return route.fulfill({ status: 204, headers: cors });
		const { url } = route.request().postDataJSON() as { url: string };
		asked.push(url);
		const body = url.includes("AAAA")
			? cal("US Holidays", "Holiday")
			: cal("My calendar", "Private thing");
		return route.fulfill({ headers: cors, json: { status: 200, body } });
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await page.locator("[data-schedee-ready]").waitFor();
	const sidebar = page.locator(".sch-sidebar");

	for (const url of [A, B]) {
		await page.keyboard.press("ControlOrMeta+k");
		await page.keyboard.type("subscribe");
		await page.keyboard.press("Enter");
		await page.keyboard.insertText(url);
		await page.keyboard.press("Enter");
	}
	await expect(sidebar).toContainText("US Holidays");
	await expect(sidebar).toContainText("My calendar");
	await expect(
		page.locator(".sch-chip[data-event-id]", { hasText: "Holiday" }),
	).toBeVisible();
	await expect(
		page.locator(".sch-chip[data-event-id]", { hasText: "Private thing" }),
	).toBeVisible();
	expect(asked).toEqual([A, B]);
});
