import { type EventInstance, Temporal } from "@schedee/core";
import { describe, expect, it } from "vitest";
import { type DragState, proposal, segments } from "./drag";

const days = Array.from({ length: 7 }, (_, i) =>
	Temporal.PlainDate.from("2026-11-09").add({ days: i }),
);
const event: EventInstance = {
	id: "e",
	sourceId: "e",
	calendarId: "c",
	title: "Test",
	start: "2026-11-14T09:00:00",
	end: "2026-11-14T10:00:00",
	allDay: false,
};
const drag = (over: Partial<DragState>): DragState => ({
	mode: "move",
	event,
	from: { col: 5, min: 560 },
	to: { col: 5, min: 560 },
	x0: 0,
	y0: 0,
	active: true,
	...over,
});
const iso = (p: ReturnType<typeof proposal>) =>
	p && [p.start.toString().slice(5, 16), p.end.toString().slice(5, 16)];

describe("drag proposals", () => {
	it("moves by whole quarter hours and across days, keeping the length", () => {
		expect(iso(proposal(drag({ to: { col: 5, min: 620 } }), days))).toEqual([
			"11-14T10:00",
			"11-14T11:00",
		]);
		expect(iso(proposal(drag({ to: { col: 3, min: 567 } }), days))).toEqual([
			"11-12T09:00",
			"11-12T10:00",
		]);
		expect(iso(proposal(drag({ to: { col: 5, min: 568 } }), days))).toEqual([
			"11-14T09:15",
			"11-14T10:15",
		]);
	});

	it("keeps a moved event inside its day", () => {
		expect(iso(proposal(drag({ to: { col: 5, min: 2000 } }), days))).toEqual([
			"11-14T23:00",
			"11-15T00:00",
		]);
		expect(iso(proposal(drag({ to: { col: 5, min: -900 } }), days))).toEqual([
			"11-14T00:00",
			"11-14T01:00",
		]);
	});

	it("resizes either edge and never below a quarter hour", () => {
		expect(
			iso(proposal(drag({ mode: "end", to: { col: 5, min: 628 } }), days)),
		).toEqual(["11-14T09:00", "11-14T10:30"]);
		expect(
			iso(proposal(drag({ mode: "end", to: { col: 5, min: 300 } }), days)),
		).toEqual(["11-14T09:00", "11-14T09:15"]);
		expect(
			iso(proposal(drag({ mode: "start", to: { col: 5, min: 700 } }), days)),
		).toEqual(["11-14T09:45", "11-14T10:00"]);
	});

	it("creates from the quarter hour under the press, in either direction", () => {
		const create = (a: number, b: number) =>
			iso(
				proposal(
					{
						mode: "create",
						from: { col: 1, min: a },
						to: { col: 1, min: b },
						x0: 0,
						y0: 0,
						active: true,
					},
					days,
				),
			);
		expect(create(605, 650)).toEqual(["11-10T10:00", "11-10T11:00"]);
		expect(create(650, 605)).toEqual(["11-10T10:00", "11-10T11:00"]);
	});

	it("splits a range into per-day segments", () => {
		const p = {
			start: Temporal.PlainDateTime.from("2026-11-10T22:00"),
			end: Temporal.PlainDateTime.from("2026-11-11T01:30"),
		};
		expect(segments(p, days)).toEqual([
			{ col: 1, startMin: 1320, endMin: 1440 },
			{ col: 2, startMin: 0, endMin: 90 },
		]);
	});
});
