import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./model";
import { matchesQuery, searchEvents } from "./search";

const range = {
	start: Temporal.PlainDate.from("2026-11-01"),
	end: Temporal.PlainDate.from("2026-11-30"),
};
const ev = (over: Partial<CalendarEvent> & { id: string }): CalendarEvent => ({
	calendarId: "c",
	title: "",
	start: "2026-11-10T09:00",
	end: "2026-11-10T10:00",
	allDay: false,
	...over,
});

describe("search", () => {
	it("matches every word across title, location and description", () => {
		const e = ev({ id: "a", title: "Design review", location: "Room 4" });
		expect(matchesQuery(e, "review room")).toBe(true);
		expect(matchesQuery(e, "DESIGN")).toBe(true);
		expect(matchesQuery(e, "design lunch")).toBe(false);
		expect(matchesQuery(e, "   ")).toBe(false);
	});

	it("returns matching occurrences in order, including a renamed one", () => {
		const series = ev({
			id: "s",
			title: "Standup",
			start: "2026-11-02T10:00",
			end: "2026-11-02T10:15",
			recurrence: { rrule: "FREQ=WEEKLY;COUNT=3" },
		});
		const renamed = ev({
			id: "s~2026-11-09T10:00:00",
			title: "Retro",
			start: "2026-11-09T10:00",
			end: "2026-11-09T10:15",
			recurringEventId: "s",
			originalStart: "2026-11-09T10:00:00",
		});
		const other = ev({ id: "x", title: "Lunch", start: "2026-11-05T12:00" });
		const all = [series, renamed, other];
		expect(
			searchEvents(all, "standup", range, "UTC").map((i) => i.start),
		).toEqual(["2026-11-02T10:00:00", "2026-11-16T10:00:00"]);
		expect(
			searchEvents(all, "retro", range, "UTC").map((i) => i.title),
		).toEqual(["Retro"]);
		expect(searchEvents(all, "nothing", range, "UTC")).toEqual([]);
	});
});
