import { describe, expect, it } from "vitest";
import { parseIcs } from "./ics";
import { vtimezone, writeCalendarObject } from "./icsWrite";
import type { CalendarEvent } from "./model";

const CAL = "caldav:a/work";
const ZONE = "America/Chicago";
const NOW = new Date("2026-11-13T12:00:00Z");
const read = (text: string, key: string) =>
	parseIcs(text, CAL, ZONE, key).events;

const original = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Apple Inc.//macOS//EN",
	"BEGIN:VTIMEZONE",
	"TZID:America/Chicago",
	"BEGIN:STANDARD",
	"DTSTART:20071104T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
	"TZOFFSETFROM:-0500",
	"TZOFFSETTO:-0600",
	"END:STANDARD",
	"BEGIN:DAYLIGHT",
	"DTSTART:20070311T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
	"TZOFFSETFROM:-0600",
	"TZOFFSETTO:-0500",
	"END:DAYLIGHT",
	"END:VTIMEZONE",
	"BEGIN:VEVENT",
	"UID:abc@icloud",
	"SEQUENCE:3",
	"SUMMARY:Standup",
	"DTSTART;TZID=America/Chicago:20261110T090000",
	"DTEND;TZID=America/Chicago:20261110T091500",
	"RRULE:FREQ=DAILY;COUNT=5",
	"X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
	"ATTENDEE;CN=Ada;PARTSTAT=ACCEPTED:mailto:ada@example.com",
	"ORGANIZER:mailto:ada@example.com",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER:-PT10M",
	"END:VALARM",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:abc@icloud",
	"RECURRENCE-ID;TZID=America/Chicago:20261111T090000",
	"SUMMARY:Standup (late)",
	"DTSTART;TZID=America/Chicago:20261111T100000",
	"DTEND;TZID=America/Chicago:20261111T101500",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

describe("writeCalendarObject", () => {
	it("rewrites what changed and keeps what we don't model", () => {
		const [series, override] = read(original, "abc");
		if (!series || !override) throw new Error("fixture");
		const text = writeCalendarObject({
			original,
			calendarId: CAL,
			key: "abc",
			events: [
				{
					...series,
					title: "Daily",
					start: "2026-11-10T09:30:00",
					end: "2026-11-10T09:45:00",
				},
				override,
			],
			fallbackZone: ZONE,
			now: NOW,
		});
		expect(text).toContain("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC");
		expect(text).toContain("TRIGGER:-PT10M");
		expect(text).toContain("SEQUENCE:4");
		expect(text.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
		expect(read(text, "abc").map((e) => [e.id, e.title, e.start])).toEqual([
			[`${CAL}#abc`, "Daily", "2026-11-10T09:30:00"],
			[
				`${CAL}#abc~2026-11-11T09:00:00`,
				"Standup (late)",
				"2026-11-11T10:00:00",
			],
		]);
		expect(read(text, "abc")[0]?.attendees?.[0]).toMatchObject({
			email: "ada@example.com",
			organizer: true,
		});
	});

	it("drops an override that's gone and adds a new one in the series' zone", () => {
		const [series] = read(original, "abc");
		if (!series) throw new Error("fixture");
		const moved: CalendarEvent = {
			id: `${CAL}#abc~2026-11-12T09:00:00`,
			calendarId: CAL,
			title: "Standup",
			start: "2026-11-12T11:00:00",
			end: "2026-11-12T11:15:00",
			allDay: false,
			timeZone: ZONE,
			recurringEventId: `${CAL}#abc`,
			originalStart: "2026-11-12T09:00:00",
		};
		const text = writeCalendarObject({
			original,
			calendarId: CAL,
			key: "abc",
			events: [
				{
					...series,
					recurrence: {
						rrule: "FREQ=DAILY;COUNT=5",
						exdates: ["2026-11-13T09:00:00"],
					},
				},
				moved,
			],
			fallbackZone: ZONE,
			now: NOW,
		});
		expect(text).not.toContain("Standup (late)");
		expect(text).toContain(
			"RECURRENCE-ID;TZID=America/Chicago:20261112T090000",
		);
		expect(text).toContain("EXDATE;TZID=America/Chicago:20261113T090000");
		expect(read(text, "abc").map((e) => e.id)).toEqual([
			`${CAL}#abc`,
			`${CAL}#abc~2026-11-12T09:00:00`,
		]);
	});

	it("writes a new event with its own zone definition", () => {
		const e: CalendarEvent = {
			id: `${CAL}#n1`,
			calendarId: CAL,
			title: "Lunch",
			start: "2026-11-14T12:00:00",
			end: "2026-11-14T13:00:00",
			allDay: false,
			timeZone: "Europe/Berlin",
			location: "Café",
			busy: false,
		};
		const text = writeCalendarObject({
			calendarId: CAL,
			key: "n1",
			events: [e],
			fallbackZone: ZONE,
			now: NOW,
		});
		expect(text).toContain("UID:n1@sched.ee");
		expect(text.indexOf("BEGIN:VTIMEZONE")).toBeLessThan(
			text.indexOf("BEGIN:VEVENT"),
		);
		const [back] = read(text, "n1");
		expect(back).toEqual(e);
	});

	it("writes all-day events as dates", () => {
		const e: CalendarEvent = {
			id: `${CAL}#d1`,
			calendarId: CAL,
			title: "Off",
			start: "2026-11-20",
			end: "2026-11-22",
			allDay: true,
		};
		const text = writeCalendarObject({
			calendarId: CAL,
			key: "d1",
			events: [e],
			fallbackZone: ZONE,
			now: NOW,
		});
		expect(text).toContain("DTSTART;VALUE=DATE:20261120");
		expect(text).not.toContain("VTIMEZONE");
		expect(read(text, "d1")).toEqual([e]);
	});
});

describe("vtimezone", () => {
	it("describes a zone's daylight saving changes", () => {
		const text = vtimezone("America/Chicago").toString();
		expect(text).toContain("TZID:America/Chicago");
		expect(text).toMatch(/BEGIN:DAYLIGHT\r\nDTSTART:\d{8}T020000\r\n/);
		expect(text).toContain("TZOFFSETFROM:-0600\r\nTZOFFSETTO:-0500");
		expect(text).toContain("20260308T020000");
	});

	it("handles a zone without changes", () => {
		const text = vtimezone("Asia/Kolkata").toString();
		expect(text).toContain("TZOFFSETTO:+0530");
	});
});
