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

/** Moves or resizes a displayed instance to a new start and end. Occurrences of a series get an override. */
export function applyMove(
	stored: CalendarEvent[],
	instance: EventInstance,
	start: string,
	end: string,
	scope: EditScope = "this",
): EditResult {
	return applyEdit(stored, instance, { start, end }, scope);
}

/** Copies a displayed instance as a new standalone event at `start`/`end` (defaults to the same time). */
export function applyDuplicate(
	instance: EventInstance,
	id: string,
	start = instance.start,
	end = instance.end,
): EditResult {
	const {
		recurrence: _r,
		recurringEventId: _s,
		originalStart: _o,
		...rest
	} = strip(instance);
	return { put: [clean({ ...rest, id, start, end })], remove: [] };
}

/**
 * The edit that reverses `result` when applied to the state after it. Pass the events as they were
 * before `result` was committed.
 */
export function invertEdit(
	before: CalendarEvent[],
	result: EditResult,
): EditResult {
	const byId = new Map(before.map((e) => [e.id, e]));
	const put: CalendarEvent[] = [];
	const remove: string[] = [];
	for (const e of result.put) {
		const old = byId.get(e.id);
		if (old) put.push(old);
		else remove.push(e.id);
	}
	for (const id of result.remove) {
		const old = byId.get(id);
		if (old && !put.includes(old)) put.push(old);
	}
	return { put, remove };
}

/** Applies `result` to a list of stored events, the way a store commit would. */
export function applyResult(
	stored: CalendarEvent[],
	result: EditResult,
): CalendarEvent[] {
	const byId = new Map(stored.map((e) => [e.id, e]));
	for (const id of result.remove) byId.delete(id);
	for (const e of result.put) byId.set(e.id, e);
	return [...byId.values()];
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

/**
 * A new event id: the calendar id, then a 32-character token. The token uses only `0-9a-f`, which
 * providers like Google accept as a client-chosen event id, so a synced copy keeps the same id.
 */
export const newEventId = (calendarId: string) =>
	`${calendarId}#${crypto.randomUUID().replaceAll("-", "")}`;

/**
 * The part of an event's id after its calendar: `cal#tok` gives `tok`, an override `cal#tok~2026-11-10`
 * gives `tok~2026-11-10`. Ids from elsewhere (demo data) come back whole. Calendar ids can contain
 * `#` themselves, so this strips the known prefix rather than splitting.
 */
export const eventToken = (e: Pick<CalendarEvent, "id" | "calendarId">) =>
	e.id.startsWith(`${e.calendarId}#`)
		? e.id.slice(e.calendarId.length + 1)
		: e.id;

/** The id `e` would have in `calendarId`. */
export const rehome = (
	e: Pick<CalendarEvent, "id" | "calendarId">,
	calendarId: string,
) => `${calendarId}#${eventToken(e)}`;

/**
 * Moves a displayed instance's event to another calendar: the whole series for an occurrence, with
 * its overrides. Ids change with the calendar, so this removes the old records and puts new ones.
 */
export function applyCalendarChange(
	stored: CalendarEvent[],
	instance: EventInstance,
	calendarId: string,
): EditResult & { id: string } {
	const source =
		stored.find((e) => e.id === instance.sourceId) ?? strip(instance);
	const masterId = rehome(source, calendarId);
	const moved = [
		source,
		...stored.filter((e) => e.recurringEventId === source.id),
	].map((e) =>
		clean({
			...e,
			id: rehome(e, calendarId),
			calendarId,
			recurringEventId: e.recurringEventId ? masterId : undefined,
		}),
	);
	return {
		put: moved,
		remove: [
			source.id,
			...stored
				.filter((e) => e.recurringEventId === source.id)
				.map((e) => e.id),
		],
		id: masterId + instance.id.slice(instance.sourceId.length),
	};
}
