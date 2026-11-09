import { Temporal } from "temporal-polyfill";
import type { CalendarEvent } from "./model";

const MINUTES_PER_DAY = 24 * 60;

// ---------------------------------------------------------------------------
// All-day rows
// ---------------------------------------------------------------------------

export interface AllDayPlacement {
	event: CalendarEvent;
	row: number;
	/** Index into the visible days. */
	startCol: number;
	/** Number of visible days covered. */
	span: number;
}

/**
 * Packs all-day events into rows for the visible `days`. Events sort by first visible day,
 * then longer spans first, then input order, and each takes the lowest free row.
 */
export function layoutAllDay(
	events: CalendarEvent[],
	days: Temporal.PlainDate[],
): AllDayPlacement[] {
	const first = days[0];
	const count = days.length;
	if (!first) return [];

	const items = events
		.filter((e) => e.allDay)
		.map((event, order) => {
			const start = Temporal.PlainDate.from(event.start);
			const end = Temporal.PlainDate.from(event.end); // exclusive
			const startCol = Math.max(0, first.until(start).days);
			const endCol = Math.min(count, first.until(end).days);
			return { event, order, startCol, span: endCol - startCol };
		})
		.filter((p) => p.span > 0)
		.sort(
			(a, b) => a.startCol - b.startCol || b.span - a.span || a.order - b.order,
		);

	const occupied: boolean[][] = []; // occupied[row][col]
	return items.map(({ event, startCol, span }) => {
		let row = 0;
		for (; ; row++) {
			const cells = occupied[row] ?? [];
			occupied[row] = cells;
			let free = true;
			for (let c = startCol; c < startCol + span; c++)
				if (cells[c]) free = false;
			if (free) {
				for (let c = startCol; c < startCol + span; c++) cells[c] = true;
				break;
			}
		}
		return { event, row, startCol, span };
	});
}

// ---------------------------------------------------------------------------
// Timed events within one day column
// ---------------------------------------------------------------------------

export interface TimedPlacement {
	event: CalendarEvent;
	/** Minutes from midnight, clipped to the day. */
	startMin: number;
	endMin: number;
	kind: "chip" | "ribbon";
	/** Horizontal placement as fractions of the chip area (column minus ribbon offset). */
	left: number;
	/** Fraction of the chip area this chip may use, before the right margin is applied. */
	width: number;
	/** Whether a ribbon runs alongside this chip, pushing it right. */
	besideRibbon: boolean;
	/** Stacking order; later chips draw on top. */
	z: number;
}

/** Free (non-busy) timed events at least this long draw as a ribbon at the column's left edge. */
export const RIBBON_MIN_MINUTES = 120;

/*
 * Overlap rule, fitted to the reference's single captured 2-way case (INFERRED for N > 2):
 * chip i of n starts at i * 1.1 / n of the area; every chip but the last is 1.451 / n wide,
 * the last runs to the right edge. For n = 2 that gives 0 / 0.55 starts and 0.7255 / 0.45 widths.
 */
const OVERLAP_STEP = 1.1;
const OVERLAP_WIDTH = 1.451;

function minutesInDay(iso: string, day: Temporal.PlainDate): number {
	const t = Temporal.PlainDateTime.from(iso);
	const mins = day
		.toPlainDateTime()
		.until(t, { largestUnit: "minutes" }).minutes;
	return Math.min(MINUTES_PER_DAY, Math.max(0, mins));
}

const overlaps = (
	a: { startMin: number; endMin: number },
	b: { startMin: number; endMin: number },
) => a.startMin < b.endMin && b.startMin < a.endMin;

/** Lays out the timed events that touch `day`. */
export function layoutDay(
	events: CalendarEvent[],
	day: Temporal.PlainDate,
): TimedPlacement[] {
	const spans = events
		.filter((e) => !e.allDay)
		.map((event, order) => ({
			event,
			order,
			startMin: minutesInDay(event.start, day),
			endMin: minutesInDay(event.end, day),
		}))
		.filter((s) => s.endMin > s.startMin);

	const isRibbon = (s: (typeof spans)[number]) =>
		s.event.busy === false && s.endMin - s.startMin >= RIBBON_MIN_MINUTES;
	const ribbons = spans.filter(isRibbon);
	const chips = spans
		.filter((s) => !isRibbon(s))
		.sort(
			(a, b) =>
				a.startMin - b.startMin ||
				b.endMin - b.startMin - (a.endMin - a.startMin) ||
				a.order - b.order,
		);

	const out: TimedPlacement[] = ribbons.map((s) => ({
		...s,
		kind: "ribbon",
		left: 0,
		width: 0,
		besideRibbon: false,
		z: 0,
	}));

	// Group chips into clusters of transitively overlapping events, then assign columns greedily.
	let cluster: typeof chips = [];
	let clusterEnd = -1;
	const flush = () => {
		const columns: number[] = []; // end minute of the last chip in each column
		const assigned = cluster.map((s) => {
			let col = columns.findIndex((end) => end <= s.startMin);
			if (col === -1) col = columns.length;
			columns[col] = s.endMin;
			return { s, col };
		});
		const n = columns.length;
		for (const { s, col } of assigned) {
			const left = n === 1 ? 0 : (col * OVERLAP_STEP) / n;
			const width = n === 1 ? 1 : col === n - 1 ? 1 - left : OVERLAP_WIDTH / n;
			out.push({
				...s,
				kind: "chip",
				left,
				width,
				besideRibbon: ribbons.some((r) => overlaps(r, s)),
				z: col + 1,
			});
		}
		cluster = [];
		clusterEnd = -1;
	};
	for (const s of chips) {
		if (cluster.length && s.startMin >= clusterEnd) flush();
		cluster.push(s);
		clusterEnd = Math.max(clusterEnd, s.endMin);
	}
	if (cluster.length) flush();

	return out.map(
		({ event, startMin, endMin, kind, left, width, besideRibbon, z }) => ({
			event,
			startMin,
			endMin,
			kind,
			left,
			width,
			besideRibbon,
			z,
		}),
	);
}
