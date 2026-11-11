import { type EventInstance, Temporal } from "@schedee/core";

/** What a press on the grid turns into once the pointer moves. */
export type DragMode = "move" | "copy" | "start" | "end" | "create";

/** A pointer position in grid terms: visible day column and minutes from midnight. */
export interface GridPoint {
	col: number;
	min: number;
}

export interface DragState {
	mode: DragMode;
	/** The instance being moved or resized; absent when creating. */
	event?: EventInstance;
	from: GridPoint;
	to: GridPoint;
	/** Client coordinates of the press, to tell a click from a drag. */
	x0: number;
	y0: number;
	active: boolean;
}

export const SNAP_MIN = 15;
/** Pointer travel (px) before a press becomes a drag. */
export const DRAG_SLOP = 3;
const DAY_MIN = 24 * 60;

const PDT = Temporal.PlainDateTime;
const snap = (m: number) => Math.round(m / SNAP_MIN) * SNAP_MIN;
const floorSnap = (m: number) => Math.floor(m / SNAP_MIN) * SNAP_MIN;
const at = (d: Temporal.PlainDate, m: number) =>
	d.toPlainDateTime().add({ minutes: m });
const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, v));

export interface Proposal {
	start: Temporal.PlainDateTime;
	end: Temporal.PlainDateTime;
}

/** Where the dragged (or new) event would land if the pointer were released now. */
export function proposal(
	drag: DragState,
	days: Temporal.PlainDate[],
): Proposal | null {
	const day = (c: number) => days[clamp(c, 0, days.length - 1)];
	const { from, to } = drag;
	if (drag.mode === "create") {
		const d = day(from.col);
		if (!d) return null;
		const a = floorSnap(clamp(from.min, 0, DAY_MIN - 1));
		const b = floorSnap(clamp(to.min, 0, DAY_MIN - 1));
		return {
			start: at(d, Math.min(a, b)),
			end: at(d, Math.max(a, b) + SNAP_MIN),
		};
	}
	const e = drag.event;
	if (!e || e.allDay) return null;
	const s = PDT.from(e.start);
	const en = PDT.from(e.end);
	if (drag.mode === "move" || drag.mode === "copy") {
		const length = s.until(en);
		const lengthMin = Math.min(DAY_MIN, length.total({ unit: "minutes" }));
		const startMin = clamp(
			snap(s.hour * 60 + s.minute + to.min - from.min),
			0,
			DAY_MIN - lengthMin,
		);
		const start = at(
			s.toPlainDate().add({ days: to.col - from.col }),
			startMin,
		);
		return { start, end: start.add(length) };
	}
	const d = day(to.col);
	if (!d) return null;
	const point = at(d, snap(clamp(to.min, 0, DAY_MIN)));
	if (drag.mode === "end") {
		const min = s.add({ minutes: SNAP_MIN });
		return { start: s, end: PDT.compare(point, min) < 0 ? min : point };
	}
	const max = en.subtract({ minutes: SNAP_MIN });
	return { start: PDT.compare(point, max) > 0 ? max : point, end: en };
}

/** The part of [start, end) that falls in each visible day, in minutes from that day's midnight. */
export function segments(
	{ start, end }: Proposal,
	days: Temporal.PlainDate[],
): { col: number; startMin: number; endMin: number }[] {
	const out: { col: number; startMin: number; endMin: number }[] = [];
	days.forEach((d, col) => {
		const d0 = d.toPlainDateTime();
		const d1 = d.add({ days: 1 }).toPlainDateTime();
		if (PDT.compare(end, d0) <= 0 || PDT.compare(start, d1) >= 0) return;
		out.push({
			col,
			startMin:
				PDT.compare(start, d0) <= 0 ? 0 : start.hour * 60 + start.minute,
			endMin: PDT.compare(end, d1) >= 0 ? DAY_MIN : end.hour * 60 + end.minute,
		});
	});
	return out;
}

/** True when the proposal leaves the event where it was. */
export const unchanged = (p: Proposal, e: EventInstance) =>
	p.start.equals(PDT.from(e.start)) && p.end.equals(PDT.from(e.end));
