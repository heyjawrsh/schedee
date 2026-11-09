import type { Temporal } from "temporal-polyfill";
import type { DayOfWeek } from "./week";
import { weekOf } from "./week";

export type ViewKind = "day" | "days" | "week" | "month";

export interface ViewState {
	kind: ViewKind;
	/** Days shown in "days" view (2 to 9). */
	count: number;
	/** The date the view is anchored on: first visible day, or any day of the visible week/month. */
	anchor: Temporal.PlainDate;
	weekStartsOn: DayOfWeek;
}

export const initialView = (
	today: Temporal.PlainDate,
	weekStartsOn: DayOfWeek = 1,
): ViewState => ({
	kind: "week",
	count: 7,
	anchor: today,
	weekStartsOn,
});

/** Days rendered as columns (day/days/week). Month view returns the 6-week grid. */
export function visibleDays(v: ViewState): Temporal.PlainDate[] {
	switch (v.kind) {
		case "day":
			return [v.anchor];
		case "days":
			return Array.from({ length: v.count }, (_, i) =>
				v.anchor.add({ days: i }),
			);
		case "week":
			return weekOf(v.anchor, v.weekStartsOn).days;
		case "month": {
			const first = v.anchor.with({ day: 1 });
			const start = weekOf(first, v.weekStartsOn).start;
			return Array.from({ length: 42 }, (_, i) => start.add({ days: i }));
		}
	}
}

/** Moves one period forward (+1) or back (-1). */
export function step(v: ViewState, dir: 1 | -1): ViewState {
	switch (v.kind) {
		case "day":
			return { ...v, anchor: v.anchor.add({ days: dir }) };
		case "days":
			return { ...v, anchor: v.anchor.add({ days: dir * v.count }) };
		case "week":
			return { ...v, anchor: v.anchor.add({ weeks: dir }) };
		case "month":
			return { ...v, anchor: v.anchor.with({ day: 1 }).add({ months: dir }) };
	}
}

/** Switches view kind, keeping the anchor sensible (N-day views start at the anchor). */
export function setView(
	v: ViewState,
	kind: ViewKind,
	count = v.count,
): ViewState {
	if (kind === "days" && count === 7) return { ...v, kind: "week", count: 7 };
	if (kind === "days" && count === 1) return { ...v, kind: "day", count: 1 };
	return {
		...v,
		kind,
		count:
			kind === "days"
				? Math.min(9, Math.max(2, count))
				: kind === "day"
					? 1
					: 7,
	};
}

export const goTo = (v: ViewState, date: Temporal.PlainDate): ViewState => ({
	...v,
	anchor: date,
});

export function viewLabel(v: ViewState): string {
	return v.kind === "day"
		? "Day"
		: v.kind === "week"
			? "Week"
			: v.kind === "month"
				? "Month"
				: `${v.count} days`;
}
