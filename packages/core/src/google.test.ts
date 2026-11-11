import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { expandEvents } from "./expand";
import {
	type GoogleEvent,
	googleCalendarKey,
	mapGoogleCalendar,
	mapGoogleEvent,
	parseGoogleRecurrence,
} from "./google";

const CHI = "America/Chicago";
const CAL = googleCalendarKey("google:ada@example.com", "ada@example.com");

describe("google calendars", () => {
	it("maps the primary calendar as default and read-only ones as subscribed", () => {
		expect(
			mapGoogleCalendar(
				{
					id: "ada@example.com",
					summary: "ada@example.com",
					backgroundColor: "#9fe1e7",
					primary: true,
					accessRole: "owner",
					selected: true,
				},
				"google:ada@example.com",
			),
		).toEqual({
			id: CAL,
			name: "ada@example.com",
			color: "#9fe1e7",
			isDefault: true,
		});
		expect(
			mapGoogleCalendar(
				{
					id: "en.usa#holiday@group.v.calendar.google.com",
					summary: "Holidays in United States",
					summaryOverride: "Holidays",
					accessRole: "reader",
					selected: false,
				},
				"google:ada@example.com",
			),
		).toMatchObject({ name: "Holidays", subscribed: true, hidden: true });
	});
});

describe("google events", () => {
	it("turns offset times into wall-clock time in the event's zone", () => {
		const e = mapGoogleEvent(
			{
				id: "abc",
				summary: "Planning",
				start: { dateTime: "2026-11-10T15:00:00Z", timeZone: CHI },
				end: { dateTime: "2026-11-10T16:30:00Z", timeZone: CHI },
				transparency: "transparent",
				visibility: "confidential",
				conferenceData: {
					conferenceSolution: { key: { type: "hangoutsMeet" } },
					entryPoints: [
						{
							entryPointType: "video",
							uri: "https://meet.google.com/aaa-bbbb-ccc",
							meetingCode: "aaa-bbbb-ccc",
						},
					],
				},
				reminders: {
					useDefault: false,
					overrides: [{ method: "popup", minutes: 10 }],
				},
			},
			CAL,
			CHI,
		);
		expect(e).toEqual({
			id: `${CAL}#abc`,
			calendarId: CAL,
			title: "Planning",
			start: "2026-11-10T09:00:00",
			end: "2026-11-10T10:30:00",
			allDay: false,
			timeZone: CHI,
			busy: false,
			visibility: "private",
			conference: {
				kind: "meet",
				url: "https://meet.google.com/aaa-bbbb-ccc",
				label: "aaa-bbbb-ccc",
			},
			reminders: [10],
		});
	});

	it("keeps all-day dates and the signed-in user's response", () => {
		const e = mapGoogleEvent(
			{
				id: "bday",
				summary: "Grace's birthday",
				eventType: "birthday",
				start: { date: "2026-11-12" },
				end: { date: "2026-11-13" },
				organizer: { email: "grace@example.com" },
				attendees: [
					{
						email: "grace@example.com",
						organizer: true,
						responseStatus: "accepted",
					},
					{ email: "ada@example.com", self: true, responseStatus: "tentative" },
				],
			},
			CAL,
			CHI,
		);
		expect(e).toMatchObject({
			start: "2026-11-12",
			end: "2026-11-13",
			allDay: true,
			glyph: "gift",
			rsvp: "tentative",
			createdBy: "grace@example.com",
		});
		expect(e).not.toHaveProperty("timeZone");
	});

	it("drops deleted events but keeps cancelled occurrences as overrides", () => {
		expect(
			mapGoogleEvent({ id: "gone", status: "cancelled" }, CAL, CHI),
		).toBeNull();
		expect(
			mapGoogleEvent(
				{
					id: "s_20261111T150000Z",
					status: "cancelled",
					recurringEventId: "s",
					originalStartTime: {
						dateTime: "2026-11-11T09:00:00-06:00",
						timeZone: CHI,
					},
				},
				CAL,
				CHI,
			),
		).toMatchObject({
			recurringEventId: `${CAL}#s`,
			originalStart: "2026-11-11T09:00:00",
			status: "cancelled",
		});
	});

	it("parses RRULE and EXDATE lines in any zone", () => {
		expect(
			parseGoogleRecurrence(
				[
					"RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
					"EXDATE;TZID=America/Chicago:20261111T090000,20261116T090000",
					"EXDATE:20261118T150000Z",
				],
				false,
				CHI,
			),
		).toEqual({
			rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
			exdates: [
				"2026-11-11T09:00:00",
				"2026-11-16T09:00:00",
				"2026-11-18T09:00:00",
			],
		});
		expect(
			parseGoogleRecurrence(
				["RRULE:FREQ=YEARLY", "EXDATE;VALUE=DATE:20271112"],
				true,
				CHI,
			),
		).toEqual({ rrule: "FREQ=YEARLY", exdates: ["2027-11-12"] });
	});

	it("expands a mapped series with its moved and cancelled occurrences", () => {
		const google: GoogleEvent[] = [
			{
				id: "s",
				summary: "Standup",
				start: { dateTime: "2026-11-09T09:00:00-06:00", timeZone: CHI },
				end: { dateTime: "2026-11-09T09:15:00-06:00", timeZone: CHI },
				recurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
			},
			{
				id: "s_20261110T150000Z",
				recurringEventId: "s",
				summary: "Standup (late)",
				originalStartTime: {
					dateTime: "2026-11-10T09:00:00-06:00",
					timeZone: CHI,
				},
				start: { dateTime: "2026-11-10T11:00:00-06:00", timeZone: CHI },
				end: { dateTime: "2026-11-10T11:15:00-06:00", timeZone: CHI },
			},
			{
				id: "s_20261111T150000Z",
				recurringEventId: "s",
				status: "cancelled",
				originalStartTime: {
					dateTime: "2026-11-11T09:00:00-06:00",
					timeZone: CHI,
				},
			},
		];
		const events = google.flatMap((g) => mapGoogleEvent(g, CAL, CHI) ?? []);
		const shown = expandEvents(
			events,
			{
				start: Temporal.PlainDate.from("2026-11-09"),
				end: Temporal.PlainDate.from("2026-11-16"),
			},
			CHI,
		).map((i) => `${i.start.slice(5, 16)} ${i.title}`);
		expect(shown).toEqual([
			"11-09T09:00 Standup",
			"11-10T11:00 Standup (late)",
			"11-12T09:00 Standup",
			"11-13T09:00 Standup",
		]);
	});
});
