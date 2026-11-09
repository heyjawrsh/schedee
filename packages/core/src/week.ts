import type { Temporal } from "temporal-polyfill";

/** ISO day of week: 1 = Monday ... 7 = Sunday. */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WeekRange {
	start: Temporal.PlainDate;
	/** Inclusive last day of the week. */
	end: Temporal.PlainDate;
	days: Temporal.PlainDate[];
}

/** The week containing `date`, starting on `weekStartsOn` (Monday by default). */
export function weekOf(
	date: Temporal.PlainDate,
	weekStartsOn: DayOfWeek = 1,
): WeekRange {
	const offset = (date.dayOfWeek - weekStartsOn + 7) % 7;
	const start = date.subtract({ days: offset });
	const days = Array.from({ length: 7 }, (_, i) => start.add({ days: i }));
	return { start, end: start.add({ days: 6 }), days };
}
