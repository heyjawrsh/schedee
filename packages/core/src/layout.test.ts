import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { layoutAllDay, layoutDay } from "./layout";
import type { CalendarEvent } from "./model";
import { weekOf } from "./week";

const days = weekOf(Temporal.PlainDate.from("2026-11-09")).days;
let n = 0;
const allDay = (start: string, end: string): CalendarEvent => ({
	id: `a${++n}`,
	calendarId: "c",
	title: `A${n}`,
	start,
	end,
	allDay: true,
});
const timed = (
	day: string,
	start: string,
	end: string,
	extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
	id: `t${++n}`,
	calendarId: "c",
	title: `T${n}`,
	start: `${day}T${start}`,
	end: `${day}T${end}`,
	allDay: false,
	...extra,
});

describe("layoutAllDay", () => {
	it("packs rows like the reference week", () => {
		const events = [
			allDay("2026-11-09", "2026-11-14"), // Mon to Fri
			allDay("2026-11-09", "2026-11-11"), // Mon to Tue
			allDay("2026-11-09", "2026-11-10"), // Mon
			allDay("2026-11-10", "2026-11-11"), // Tue
			allDay("2026-11-10", "2026-11-11"), // Tue
			allDay("2026-11-11", "2026-11-12"), // Wed
			allDay("2026-11-15", "2026-11-16"), // Sun
		];
		const rows = layoutAllDay(events, days).map((p) => [
			p.row,
			p.startCol,
			p.span,
		]);
		expect(rows).toEqual([
			[0, 0, 5],
			[1, 0, 2],
			[2, 0, 1],
			[2, 1, 1],
			[3, 1, 1],
			[1, 2, 1],
			[0, 6, 1],
		]);
	});

	it("clips events that start before or end after the visible days", () => {
		const [p] = layoutAllDay([allDay("2026-11-01", "2026-11-11")], days);
		expect(p).toMatchObject({ startCol: 0, span: 2 });
		const [q] = layoutAllDay([allDay("2026-11-14", "2026-11-30")], days);
		expect(q).toMatchObject({ startCol: 5, span: 2 });
		expect(layoutAllDay([allDay("2026-12-01", "2026-12-02")], days)).toEqual(
			[],
		);
	});
});

describe("layoutDay", () => {
	const day = Temporal.PlainDate.from("2026-11-13");

	it("places a lone chip across the full area", () => {
		const [p] = layoutDay([timed("2026-11-13", "08:30", "10:00")], day);
		expect(p).toMatchObject({
			startMin: 510,
			endMin: 600,
			kind: "chip",
			left: 0,
			width: 1,
		});
	});

	it("splits a 2-way overlap like the reference, longer event first", () => {
		const short = timed("2026-11-13", "12:00", "13:00");
		const long = timed("2026-11-13", "12:00", "14:00");
		const [a, b] = layoutDay([short, long], day);
		expect(a?.event).toBe(long);
		expect(a).toMatchObject({ left: 0, z: 1 });
		expect(a?.width).toBeCloseTo(0.7255, 4);
		expect(b?.event).toBe(short);
		expect(b?.left).toBeCloseTo(0.55, 4);
		expect(b?.width).toBeCloseTo(0.45, 4);
	});

	it("draws long free events as a ribbon and flags chips beside it", () => {
		const ribbon = timed("2026-11-13", "10:00", "16:00", { busy: false });
		const inside = timed("2026-11-13", "10:15", "10:30");
		const before = timed("2026-11-13", "08:30", "10:00");
		const placed = layoutDay([ribbon, inside, before], day);
		expect(placed.find((p) => p.event === ribbon)?.kind).toBe("ribbon");
		expect(placed.find((p) => p.event === inside)?.besideRibbon).toBe(true);
		expect(placed.find((p) => p.event === before)?.besideRibbon).toBe(false);
	});

	it("keeps short free events as ordinary chips", () => {
		const [p] = layoutDay(
			[timed("2026-11-13", "09:00", "10:00", { busy: false })],
			day,
		);
		expect(p?.kind).toBe("chip");
	});

	it("clips events that cross midnight to the day", () => {
		const e: CalendarEvent = {
			...timed("2026-11-12", "23:00", "23:30"),
			end: "2026-11-13T01:00",
		};
		const [p] = layoutDay([e], day);
		expect(p).toMatchObject({ startMin: 0, endMin: 60 });
	});
});
