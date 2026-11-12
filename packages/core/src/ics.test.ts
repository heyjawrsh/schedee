import { describe, expect, it } from "vitest";
import { feedUrl, parseIcs, resolveZone } from "./ics";

const feed = (...events: string[]) =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Test//EN",
		"X-WR-CALNAME:Team rota",
		"X-APPLE-CALENDAR-COLOR:#1BADF8FF",
		"REFRESH-INTERVAL;VALUE=DURATION:PT2H",
		...events,
		"END:VCALENDAR",
	].join("\r\n");
const vevent = (...lines: string[]) =>
	["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const parse = (text: string) => parseIcs(text, "ics:rota", "America/Chicago");

describe("parseIcs", () => {
	it("reads the feed's name, color and refresh interval", () => {
		const f = parse(feed());
		expect(f).toMatchObject({
			name: "Team rota",
			color: "#1BADF8",
			refreshMinutes: 120,
			events: [],
		});
	});

	it("keeps an IANA zone and moves UTC into the viewer's zone", () => {
		const { events } = parse(
			feed(
				vevent(
					"UID:a@x",
					"SUMMARY:Standup",
					"DTSTART;TZID=Europe/Berlin:20261112T090000",
					"DTEND;TZID=Europe/Berlin:20261112T093000",
				),
				vevent(
					"UID:b@x",
					"SUMMARY:Call",
					"DTSTART:20261112T160000Z",
					"DTEND:20261112T170000Z",
					"TRANSP:TRANSPARENT",
					"LOCATION:Room 4",
				),
			),
		);
		expect(events).toEqual([
			{
				id: "ics:rota#a@x",
				calendarId: "ics:rota",
				title: "Standup",
				start: "2026-11-12T09:00:00",
				end: "2026-11-12T09:30:00",
				allDay: false,
				timeZone: "Europe/Berlin",
			},
			{
				id: "ics:rota#b@x",
				calendarId: "ics:rota",
				title: "Call",
				start: "2026-11-12T10:00:00",
				end: "2026-11-12T11:00:00",
				allDay: false,
				timeZone: "America/Chicago",
				busy: false,
				location: "Room 4",
			},
		]);
	});

	it("gives an all-day event with no end one day", () => {
		const [e] = parse(
			feed(vevent("UID:h", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261126")),
		).events;
		expect(e).toMatchObject({
			start: "2026-11-26",
			end: "2026-11-27",
			allDay: true,
		});
		expect(e?.timeZone).toBeUndefined();
	});

	it("keeps a series' rule and skipped dates, and its moved and cancelled occurrences", () => {
		const { events } = parse(
			feed(
				vevent(
					"UID:s",
					"RECURRENCE-ID;TZID=America/New_York:20261118T100000",
					"SUMMARY:Sync (moved)",
					"DTSTART;TZID=America/New_York:20261118T140000",
					"DTEND;TZID=America/New_York:20261118T150000",
				),
				vevent(
					"UID:s",
					"SUMMARY:Sync",
					"DTSTART;TZID=America/New_York:20261111T100000",
					"DTEND;TZID=America/New_York:20261111T110000",
					"RRULE:FREQ=WEEKLY;BYDAY=WE",
					"EXDATE;TZID=America/New_York:20261125T100000",
				),
				vevent(
					"UID:s",
					"RECURRENCE-ID;TZID=America/New_York:20261202T100000",
					"STATUS:CANCELLED",
					"DTSTART;TZID=America/New_York:20261202T100000",
					"DTEND;TZID=America/New_York:20261202T110000",
				),
			),
		);
		const [series, moved, gone] = events;
		expect(series).toMatchObject({
			id: "ics:rota#s",
			timeZone: "America/New_York",
			recurrence: {
				rrule: "FREQ=WEEKLY;BYDAY=WE",
				exdates: ["2026-11-25T10:00:00"],
			},
		});
		expect(moved).toMatchObject({
			id: "ics:rota#s~2026-11-18T10:00:00",
			recurringEventId: "ics:rota#s",
			originalStart: "2026-11-18T10:00:00",
			start: "2026-11-18T14:00:00",
			title: "Sync (moved)",
		});
		expect(gone).toMatchObject({
			recurringEventId: "ics:rota#s",
			originalStart: "2026-12-02T10:00:00",
			status: "cancelled",
		});
	});

	it("names Windows zones and falls back to the VTIMEZONE for unknown ones", () => {
		const { events } = parse(
			feed(
				[
					"BEGIN:VTIMEZONE",
					"TZID:Office Time",
					"BEGIN:STANDARD",
					"DTSTART:16010101T000000",
					"TZOFFSETFROM:+0100",
					"TZOFFSETTO:+0100",
					"END:STANDARD",
					"END:VTIMEZONE",
				].join("\r\n"),
				vevent(
					"UID:w",
					"DTSTART;TZID=Pacific Standard Time:20261112T080000",
					"DTEND;TZID=Pacific Standard Time:20261112T090000",
				),
				vevent(
					"UID:o",
					"DTSTART;TZID=Office Time:20261112T170000",
					"DTEND;TZID=Office Time:20261112T180000",
				),
			),
		);
		expect(events[0]).toMatchObject({
			start: "2026-11-12T08:00:00",
			timeZone: "America/Los_Angeles",
		});
		// 17:00 at +01:00 is 10:00 in Chicago (CST, -06:00).
		expect(events[1]).toMatchObject({
			start: "2026-11-12T10:00:00",
			timeZone: "America/Chicago",
		});
	});

	it("keeps floating times on the clock, skips cancelled singles and keeps duplicate UIDs", () => {
		const { events } = parse(
			feed(
				vevent("UID:f", "SUMMARY:Lunch", "DTSTART:20261112T120000"),
				vevent("UID:f", "SUMMARY:Lunch again", "DTSTART:20261113T120000"),
				vevent("UID:c", "STATUS:CANCELLED", "DTSTART:20261112T120000"),
			),
		);
		expect(events.map((e) => [e.id, e.start, e.end, e.timeZone])).toEqual([
			[
				"ics:rota#f",
				"2026-11-12T12:00:00",
				"2026-11-12T12:00:00",
				"America/Chicago",
			],
			[
				"ics:rota#f~1",
				"2026-11-13T12:00:00",
				"2026-11-13T12:00:00",
				"America/Chicago",
			],
		]);
	});
});

describe("feed URLs", () => {
	it("turns webcal into https and refuses other schemes", () => {
		expect(feedUrl(" webcal://example.com/a.ics ")).toBe(
			"https://example.com/a.ics",
		);
		expect(feedUrl("https://example.com/a.ics")).toBe(
			"https://example.com/a.ics",
		);
		expect(feedUrl("file:///etc/passwd")).toBeNull();
		expect(feedUrl("not a url")).toBeNull();
	});

	it("resolves zone ids", () => {
		expect(resolveZone("Europe/Paris")).toBe("Europe/Paris");
		expect(resolveZone("Eastern Standard Time")).toBe("America/New_York");
		expect(resolveZone("/mozilla.org/20050126_1/America/Denver")).toBe(
			"America/Denver",
		);
		expect(resolveZone("Nowhere Time")).toBeUndefined();
	});
});

describe("feed series in the calendar", () => {
	it("expands with its moved, skipped and cancelled occurrences", async () => {
		const { expandEvents, Temporal } = await import("./index");
		const { events } = parse(
			feed(
				vevent(
					"UID:s",
					"SUMMARY:Sync",
					"DTSTART;TZID=America/Chicago:20261104T100000",
					"DTEND;TZID=America/Chicago:20261104T110000",
					"RRULE:FREQ=WEEKLY;COUNT=5",
					"EXDATE;TZID=America/Chicago:20261111T100000",
				),
				vevent(
					"UID:s",
					"RECURRENCE-ID;TZID=America/Chicago:20261118T100000",
					"SUMMARY:Sync (moved)",
					"DTSTART;TZID=America/Chicago:20261118T150000",
					"DTEND;TZID=America/Chicago:20261118T160000",
				),
				vevent(
					"UID:s",
					"RECURRENCE-ID;TZID=America/Chicago:20261125T100000",
					"STATUS:CANCELLED",
					"DTSTART;TZID=America/Chicago:20261125T100000",
				),
			),
		);
		const shown = expandEvents(
			events,
			{
				start: Temporal.PlainDate.from("2026-11-01"),
				end: Temporal.PlainDate.from("2026-12-31"),
			},
			"America/Chicago",
		).map((i) => `${i.start} ${i.title}`);
		expect(shown).toEqual([
			"2026-11-04T10:00:00 Sync",
			"2026-11-18T15:00:00 Sync (moved)",
			"2026-12-02T10:00:00 Sync",
		]);
	});
});
