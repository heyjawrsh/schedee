import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { applyDelete, applyEdit } from "./edit";
import { expandEvents } from "./expand";
import type { CalendarEvent } from "./model";

const CHI = "America/Chicago";
const week = {
	start: Temporal.PlainDate.from("2026-11-09"),
	end: Temporal.PlainDate.from("2026-11-16"),
};
const series: CalendarEvent = {
	id: "s",
	calendarId: "c",
	title: "Standup",
	start: "2026-01-05T10:15:00",
	end: "2026-01-05T10:30:00",
	allDay: false,
	recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
};
const single: CalendarEvent = {
	id: "x",
	calendarId: "c",
	title: "One-off",
	start: "2026-11-10T09:00",
	end: "2026-11-10T10:00",
	allDay: false,
};
const commit = (
	stored: CalendarEvent[],
	r: { put: CalendarEvent[]; remove: string[] },
) => {
	const map = new Map(stored.map((e) => [e.id, e]));
	for (const id of r.remove) map.delete(id);
	for (const e of r.put) map.set(e.id, e);
	return [...map.values()];
};
const show = (stored: CalendarEvent[]) =>
	expandEvents(stored, week, CHI)
		.map((i) => `${i.start.slice(5, 16)} ${i.title}`)
		.sort();
const tue = (stored: CalendarEvent[]) => {
	const i = expandEvents(stored, week, CHI).find(
		(x) => x.sourceId === "s" && x.start.startsWith("2026-11-10"),
	);
	if (!i) throw new Error("no Tuesday occurrence");
	return i;
};

describe("applyEdit", () => {
	it("updates a single event in place", () => {
		const [inst] = expandEvents([single], week, CHI);
		if (!inst) throw new Error("missing");
		const out = commit(
			[single],
			applyEdit([single], inst, { title: "Renamed" }),
		);
		expect(show(out)).toEqual(["11-10T09:00 Renamed"]);
	});

	it("edits one occurrence of a series as an override", () => {
		let stored = [series];
		stored = commit(
			stored,
			applyEdit(stored, tue(stored), {
				title: "Moved standup",
				start: "2026-11-10T15:00:00",
				end: "2026-11-10T15:15:00",
			}),
		);
		const out = show(stored);
		expect(out).toHaveLength(5);
		expect(out).toContain("11-10T15:00 Moved standup");
		expect(out.filter((s) => s.includes("10:15 Standup"))).toHaveLength(4);
		// A second edit to the same occurrence updates the same override.
		stored = commit(
			stored,
			applyEdit(stored, tue(stored), { title: "Moved again" }),
		);
		expect(stored).toHaveLength(2);
		expect(show(stored)).toContain("11-10T15:00 Moved again");
	});

	it("shifts the whole series when editing all events", () => {
		const stored = commit(
			[series],
			applyEdit(
				[series],
				tue([series]),
				{ start: "2026-11-10T11:00:00", end: "2026-11-10T11:30:00" },
				"all",
			),
		);
		const out = show(stored);
		expect(out).toHaveLength(5);
		expect(out.every((s) => s.includes("T11:00 Standup"))).toBe(true);
		expect(stored[0]?.start).toBe("2026-01-05T11:00:00");
		expect(stored[0]?.end).toBe("2026-01-05T11:30:00");
	});
});

describe("applyDelete", () => {
	it("removes one occurrence with an EXDATE and drops its override", () => {
		let stored = commit(
			[series],
			applyEdit([series], tue([series]), { title: "Override" }),
		);
		stored = commit(stored, applyDelete(stored, tue(stored), "this"));
		expect(show(stored)).toHaveLength(4);
		expect(stored).toHaveLength(1);
	});

	it("removes the whole series with its overrides", () => {
		const stored = commit(
			[series, single],
			applyEdit([series, single], tue([series]), { title: "Override" }),
		);
		const out = commit(stored, applyDelete(stored, tue(stored), "all"));
		expect(out.map((e) => e.id)).toEqual(["x"]);
	});
});
