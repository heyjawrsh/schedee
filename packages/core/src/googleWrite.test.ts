import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	applyCalendarChange,
	applyDelete,
	applyEdit,
	applyResult,
	type EditResult,
	invertEdit,
} from "./edit";
import { expandEvents } from "./expand";
import { googleInstance, planGoogleWrites, toGoogleBody } from "./googleWrite";
import type { CalendarEvent, EventInstance } from "./model";

const CHI = "America/Chicago";
const ACC = "google:ada@example.com";
const WORK = `${ACC}/ada@example.com`;
const TEAM = `${ACC}/team@group.calendar.google.com`;
const LOCAL = "home";

const target = (id: string) =>
	id.startsWith(`${ACC}/`)
		? { accountId: ACC, calendarId: id.slice(ACC.length + 1) }
		: undefined;

const single: CalendarEvent = {
	id: `${WORK}#abc123`,
	calendarId: WORK,
	title: "Review",
	start: "2026-11-10T09:00:00",
	end: "2026-11-10T10:00:00",
	allDay: false,
	timeZone: CHI,
};
const series: CalendarEvent = {
	id: `${WORK}#s`,
	calendarId: WORK,
	title: "Standup",
	start: "2026-11-09T09:00:00",
	end: "2026-11-09T09:15:00",
	allDay: false,
	timeZone: CHI,
	recurrence: { rrule: "FREQ=DAILY;COUNT=5" },
};

/** Commits `r` against `stored` and plans the writes, the way the store does. */
function plan(stored: CalendarEvent[], r: EditResult) {
	const before = new Map(stored.map((e) => [e.id, e]));
	const after = new Map(applyResult(stored, r).map((e) => [e.id, e]));
	return planGoogleWrites(r, before, after, target, CHI);
}

const occurrence = (stored: CalendarEvent[], day: string): EventInstance => {
	const found = expandEvents(
		stored,
		{
			start: Temporal.PlainDate.from(day),
			end: Temporal.PlainDate.from(day).add({ days: 1 }),
		},
		CHI,
	)[0];
	if (!found) throw new Error(`nothing on ${day}`);
	return found;
};

describe("google writes", () => {
	it("inserts a new event under its own token", () => {
		const [w] = plan([], { put: [single], remove: [] });
		expect(w).toMatchObject({
			kind: "insert",
			accountId: ACC,
			calendarId: "ada@example.com",
			localIds: [single.id],
			notify: false,
			body: {
				id: "abc123",
				summary: "Review",
				start: { dateTime: "2026-11-10T09:00:00", timeZone: CHI },
				transparency: "opaque",
				reminders: { useDefault: true },
			},
		});
	});

	it("patches only what changed", () => {
		const moved = {
			...single,
			start: "2026-11-10T11:00:00",
			end: "2026-11-10T12:00:00",
		};
		expect(plan([single], { put: [moved], remove: [] })).toEqual([
			expect.objectContaining({
				kind: "patch",
				eventId: "abc123",
				body: {
					start: { dateTime: "2026-11-10T11:00:00", timeZone: CHI },
					end: { dateTime: "2026-11-10T12:00:00", timeZone: CHI },
				},
			}),
		]);
		expect(plan([single], { put: [{ ...single }], remove: [] })).toEqual([]);
	});

	it("deletes, and leaves local calendars alone", () => {
		expect(plan([single], { put: [], remove: [single.id] })).toEqual([
			expect.objectContaining({ kind: "delete", eventId: "abc123" }),
		]);
		const local = { ...single, id: "x", calendarId: LOCAL };
		expect(plan([], { put: [local], remove: [] })).toEqual([]);
	});

	it("names occurrences the way Google does", () => {
		expect(googleInstance(series, "2026-11-10T09:00:00", CHI)).toEqual({
			id: "s_20261110T150000Z",
			seriesId: "s",
			originalStart: "2026-11-10T15:00:00Z",
		});
		expect(
			googleInstance(
				{ ...series, allDay: true, start: "2026-11-09", end: "2026-11-10" },
				"2026-11-10",
				CHI,
			).id,
		).toBe("s_20261110");
	});

	it("writes one occurrence, and undoing it puts the series' time back", () => {
		const stored = [series];
		const tue = occurrence(stored, "2026-11-10");
		const r = applyEdit(stored, tue, { title: "Standup (late)" }, "this");
		const [w] = plan(stored, r);
		expect(w).toMatchObject({
			kind: "patch",
			eventId: "s_20261110T150000Z",
			instance: { seriesId: "s" },
			body: { summary: "Standup (late)", status: "confirmed" },
		});
		expect(w?.kind === "patch" && w.body.recurrence).toBeFalsy();

		const after = applyResult(stored, r);
		const [undo] = plan(after, invertEdit(stored, r));
		expect(undo).toMatchObject({
			kind: "patch",
			eventId: "s_20261110T150000Z",
			body: {
				summary: "Standup",
				start: { dateTime: "2026-11-10T09:00:00", timeZone: CHI },
				status: "confirmed",
			},
		});
	});

	it("skips one occurrence by deleting the instance, and undo restores it", () => {
		const stored = [series];
		const r = applyDelete(stored, occurrence(stored, "2026-11-11"), "this");
		expect(plan(stored, r)).toEqual([
			expect.objectContaining({
				kind: "delete",
				eventId: "s_20261111T150000Z",
			}),
		]);
		const after = applyResult(stored, r);
		expect(plan(after, invertEdit(stored, r))).toEqual([
			expect.objectContaining({
				kind: "patch",
				eventId: "s_20261111T150000Z",
				body: { status: "confirmed" },
			}),
		]);
	});

	it("deletes a whole series once, not each exception", () => {
		const late = applyEdit(
			[series],
			occurrence([series], "2026-11-10"),
			{ title: "Late" },
			"this",
		);
		const stored = applyResult([series], late);
		const r = applyDelete(stored, occurrence(stored, "2026-11-12"), "all");
		expect(plan(stored, r)).toEqual([
			expect.objectContaining({ kind: "delete", eventId: "s" }),
		]);
	});

	it("shifts a whole series with one patch", () => {
		const r = applyEdit(
			[series],
			occurrence([series], "2026-11-10"),
			{ start: "2026-11-10T10:00:00", end: "2026-11-10T10:15:00" },
			"all",
		);
		expect(plan([series], r)).toEqual([
			expect.objectContaining({
				kind: "patch",
				eventId: "s",
				body: {
					start: { dateTime: "2026-11-09T10:00:00", timeZone: CHI },
					end: { dateTime: "2026-11-09T10:15:00", timeZone: CHI },
				},
			}),
		]);
	});

	it("moves between calendars in one account, and copies across accounts", () => {
		const inst = occurrence([single], "2026-11-10");
		const r = applyCalendarChange([single], inst, TEAM);
		expect(r.id).toBe(`${TEAM}#abc123`);
		expect(plan([single], r)).toEqual([
			expect.objectContaining({
				kind: "move",
				calendarId: "ada@example.com",
				eventId: "abc123",
				destination: "team@group.calendar.google.com",
			}),
		]);
		const out = applyCalendarChange([single], inst, LOCAL);
		expect(plan([single], out)).toEqual([
			expect.objectContaining({ kind: "delete", eventId: "abc123" }),
		]);
		const local = { ...single, id: `${LOCAL}#abc123`, calendarId: LOCAL };
		const into = applyCalendarChange(
			[local],
			occurrence([local], "2026-11-10"),
			WORK,
		);
		expect(plan([local], into)).toEqual([
			expect.objectContaining({
				kind: "insert",
				body: expect.objectContaining({ id: "abc123" }),
			}),
		]);
	});

	it("emails guests only when someone else is invited", () => {
		const meeting = {
			...single,
			attendees: [
				{ email: "ada@example.com", self: true, rsvp: "accepted" as const },
				{ email: "grace@example.com" },
			],
		};
		const [w] = plan([meeting], {
			put: [{ ...meeting, title: "Review (moved)" }],
			remove: [],
		});
		expect(w?.notify).toBe(true);
	});

	it("writes recurrence with exdates in the series zone", () => {
		expect(
			toGoogleBody(
				{
					...series,
					recurrence: { rrule: "FREQ=DAILY", exdates: ["2026-11-11T09:00:00"] },
				},
				"UTC",
			).recurrence,
		).toEqual([
			"RRULE:FREQ=DAILY",
			"EXDATE;TZID=America/Chicago:20261111T090000",
		]);
	});
});
