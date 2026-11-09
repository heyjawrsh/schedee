import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { expandEvents } from "./expand";
import type { CalendarEvent } from "./model";

const CHI = "America/Chicago";
const range = (start: string, days = 7) => {
	const s = Temporal.PlainDate.from(start);
	return { start: s, end: s.add({ days }) };
};
const ev = (e: Partial<CalendarEvent>): CalendarEvent => ({
	id: "e",
	calendarId: "c",
	title: "T",
	start: "2026-11-09T10:15",
	end: "2026-11-09T10:30",
	allDay: false,
	...e,
});
const starts = (xs: { start: string }[]) => xs.map((x) => x.start).sort();

describe("expandEvents", () => {
	it("passes single events through when they touch the range", () => {
		const out = expandEvents(
			[
				ev({}),
				ev({ id: "x", start: "2026-12-01T09:00", end: "2026-12-01T10:00" }),
			],
			range("2026-11-09"),
			CHI,
		);
		expect(out.map((e) => e.id)).toEqual(["e"]);
	});

	it("expands a weekday daily series and keeps wall-clock time across the DST change", () => {
		const daily = ev({
			start: "2026-10-26T10:15:00",
			end: "2026-10-26T10:30:00",
			timeZone: CHI,
			recurrence: { rrule: "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR" },
		});
		// US DST ended on 2026-11-01; the meeting must stay at 10:15 local on both sides.
		const out = expandEvents([daily], range("2026-10-26", 14), CHI);
		expect(out).toHaveLength(10);
		expect(new Set(out.map((o) => o.start.slice(11, 16)))).toEqual(
			new Set(["10:15"]),
		);
	});

	it("skips EXDATEs and applies overrides and cancellations", () => {
		const series = ev({
			id: "s",
			start: "2026-11-09T10:15:00",
			end: "2026-11-09T10:30:00",
			recurrence: {
				rrule: "FREQ=DAILY;COUNT=5",
				exdates: ["2026-11-10T10:15:00"],
			},
		});
		const moved = ev({
			id: "o1",
			recurringEventId: "s",
			originalStart: "2026-11-11T10:15:00",
			start: "2026-11-11T15:00:00",
			end: "2026-11-11T15:30:00",
			title: "Moved",
		});
		const cancelled = ev({
			id: "o2",
			recurringEventId: "s",
			originalStart: "2026-11-12T10:15:00",
			status: "cancelled",
		});
		const out = expandEvents(
			[series, moved, cancelled],
			range("2026-11-09"),
			CHI,
		);
		expect(starts(out)).toEqual([
			"2026-11-09T10:15:00",
			"2026-11-11T15:00:00",
			"2026-11-13T10:15:00",
		]);
		expect(out.find((o) => o.start.startsWith("2026-11-11"))?.title).toBe(
			"Moved",
		);
		expect(new Set(out.map((o) => o.sourceId))).toEqual(new Set(["s"]));
	});

	it("converts timed events from their own zone into the viewer's", () => {
		const london = ev({
			start: "2026-11-10T15:00",
			end: "2026-11-10T16:00",
			timeZone: "Europe/London",
		});
		const [o] = expandEvents([london], range("2026-11-09"), CHI);
		expect(o?.start).toBe("2026-11-10T09:00:00");
		expect(o?.end).toBe("2026-11-10T10:00:00");
	});

	it("expands all-day yearly series by date", () => {
		const bday = ev({
			allDay: true,
			start: "2020-11-10",
			end: "2020-11-11",
			recurrence: { rrule: "FREQ=YEARLY" },
		});
		const out = expandEvents([bday], range("2026-11-09"), CHI);
		expect(out.map((o) => [o.start, o.end])).toEqual([
			["2026-11-10", "2026-11-11"],
		]);
	});

	it("handles a nonexistent local time on the spring-forward day", () => {
		const e = ev({
			start: "2027-03-14T02:30",
			end: "2027-03-14T03:30",
			timeZone: CHI,
		});
		const [o] = expandEvents([e], range("2027-03-08"), "UTC");
		expect(o?.start).toBe("2027-03-14T08:30:00"); // 02:30 does not exist; "compatible" moves it to 03:30 CDT
	});
});
