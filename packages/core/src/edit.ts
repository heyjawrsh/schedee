import { Temporal } from "temporal-polyfill";
import type { CalendarEvent, EventInstance } from "./model";

export type EditScope = "this" | "all";

/** A partial event where an explicit `undefined` removes the field. */
export type EventPatch = {
	[K in keyof CalendarEvent]?: CalendarEvent[K] | undefined;
};

const clean = (e: Record<string, unknown>): CalendarEvent => {
	for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
	return e as unknown as CalendarEvent;
};

export interface EditResult {
	put: CalendarEvent[];
	remove: string[];
}

const strip = (i: EventInstance): CalendarEvent => {
	const { sourceId: _s, occurrence: _o, ...e } = i;
	return e;
};
export const overrideId = (seriesId: string, occurrence: string) =>
	`${seriesId}~${occurrence}`;

const shift = (iso: string, allDay: boolean, delta: Temporal.Duration) =>
	allDay
		? Temporal.PlainDate.from(iso).add(delta).toString()
		: Temporal.PlainDateTime.from(iso).add(delta).toString();

/**
 * Applies `patch` to a displayed instance. Single events are updated in place. For an occurrence of a
 * series, scope "this" writes an override; scope "all" updates the series master, carrying a time
 * change over as the same shift of the series start.
 */
export function applyEdit(
	stored: CalendarEvent[],
	instance: EventInstance,
	patch: EventPatch,
	scope: EditScope = "this",
): EditResult {
	const master = stored.find((e) => e.id === instance.sourceId);
	if (!instance.occurrence || !master?.recurrence) {
		const current = stored.find((e) => e.id === instance.id) ?? strip(instance);
		return {
			put: [clean({ ...current, ...patch, id: current.id })],
			remove: [],
		};
	}
	if (scope === "this") {
		const id = overrideId(master.id, instance.occurrence);
		const existing = stored.find((e) => e.id === id);
		const { recurrence: _r, ...base } = { ...master, ...strip(instance) };
		return {
			put: [
				clean({
					...base,
					...existing,
					...patch,
					id,
					recurringEventId: master.id,
					originalStart: instance.occurrence,
				}),
			],
			remove: [],
		};
	}
	// scope "all": shift the series by however far this occurrence moved, keep everything else.
	const { start, end, ...rest } = patch;
	const next = clean({ ...master, ...rest, id: master.id });
	if (start !== undefined || end !== undefined) {
		const allDay = rest.allDay ?? master.allDay;
		const from = allDay
			? Temporal.PlainDate.from(instance.start)
			: Temporal.PlainDateTime.from(instance.start);
		const to = start ?? instance.start;
		const delta = allDay
			? (from as Temporal.PlainDate).until(Temporal.PlainDate.from(to))
			: (from as Temporal.PlainDateTime).until(Temporal.PlainDateTime.from(to));
		const length = allDay
			? Temporal.PlainDate.from(to).until(
					Temporal.PlainDate.from(end ?? instance.end),
				)
			: Temporal.PlainDateTime.from(to).until(
					Temporal.PlainDateTime.from(end ?? instance.end),
				);
		next.start = shift(master.start, allDay, delta);
		next.end = allDay
			? Temporal.PlainDate.from(next.start).add(length).toString()
			: Temporal.PlainDateTime.from(next.start).add(length).toString();
	}
	return { put: [next], remove: [] };
}

/** Deletes a displayed instance: the whole event, one occurrence (EXDATE), or the whole series. */
export function applyDelete(
	stored: CalendarEvent[],
	instance: EventInstance,
	scope: EditScope = "this",
): EditResult {
	const master = stored.find((e) => e.id === instance.sourceId);
	if (!instance.occurrence || !master?.recurrence)
		return { put: [], remove: [instance.sourceId] };
	if (scope === "all") {
		return {
			put: [],
			remove: [
				master.id,
				...stored
					.filter((e) => e.recurringEventId === master.id)
					.map((e) => e.id),
			],
		};
	}
	const exdates = [...(master.recurrence.exdates ?? []), instance.occurrence];
	return {
		put: [{ ...master, recurrence: { ...master.recurrence, exdates } }],
		remove: stored
			.filter((e) => e.id === overrideId(master.id, instance.occurrence ?? ""))
			.map((e) => e.id),
	};
}
