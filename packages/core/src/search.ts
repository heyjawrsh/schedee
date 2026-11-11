import { type DateRange, expandEvents } from "./expand";
import type { CalendarEvent, EventInstance } from "./model";

/** Every word of the query appears in the title, location or description. */
export function matchesQuery(e: CalendarEvent, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return false;
	const hay = [e.title, e.location ?? "", e.description ?? ""]
		.join("\n")
		.toLowerCase();
	return words.every((w) => hay.includes(w));
}

/**
 * Instances in `range` that match `query`, oldest first. Only series with a matching master or
 * a matching override are expanded, so a narrow query stays cheap over a long range.
 */
export function searchEvents(
	events: CalendarEvent[],
	query: string,
	range: DateRange,
	viewZone: string,
): EventInstance[] {
	const roots = new Set(
		events
			.filter((e) => matchesQuery(e, query))
			.map((e) => e.recurringEventId ?? e.id),
	);
	if (roots.size === 0) return [];
	const pool = events.filter((e) => roots.has(e.recurringEventId ?? e.id));
	return expandEvents(pool, range, viewZone)
		.filter((i) => i.status !== "cancelled" && matchesQuery(i, query))
		.sort((a, b) => a.start.localeCompare(b.start));
}
