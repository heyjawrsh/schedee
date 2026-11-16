import { Temporal } from "temporal-polyfill";
import { type EditResult, eventToken } from "./edit";
import type { GoogleEventTime } from "./google";
import type { CalendarEvent, Rsvp } from "./model";

// Turns local edits into Google Calendar API v3 writes. Pure: the app queues what this returns.

/** The writable part of a Google event, as sent in an insert or patch body. */
export interface GoogleEventBody {
	id?: string;
	status?: "confirmed";
	summary?: string;
	description?: string;
	location?: string;
	start?: GoogleEventTime;
	end?: GoogleEventTime;
	recurrence?: string[];
	transparency?: "opaque" | "transparent";
	visibility?: "default" | "public" | "private";
	attendees?: {
		email: string;
		displayName?: string;
		responseStatus?: Rsvp;
		resource?: boolean;
	}[];
	reminders?: {
		useDefault: boolean;
		overrides?: { method: "popup"; minutes: number }[];
	};
}

/** Where one of our calendars lives in Google. */
export interface GoogleTarget {
	accountId: string;
	/** Google's calendar id. */
	calendarId: string;
}

/** One occurrence of a series, for writes that target it. */
export interface GoogleInstanceRef {
	/** Google's id for the series. */
	seriesId: string;
	/** The occurrence's original start as RFC 3339, for looking the instance up. */
	originalStart: string;
}

interface WriteBase extends GoogleTarget {
	/** Our ids this write touches. Sync leaves them alone until the write is sent. */
	localIds: string[];
	/** Guests other than the user are on it, so Google should email them. */
	notify: boolean;
}

export type GoogleWrite = WriteBase &
	(
		| { kind: "insert"; body: GoogleEventBody }
		| {
				kind: "patch";
				eventId: string;
				body: GoogleEventBody;
				instance?: GoogleInstanceRef;
		  }
		| { kind: "delete"; eventId: string; instance?: GoogleInstanceRef }
		| { kind: "move"; eventId: string; destination: string }
	);

const second = (iso: string) =>
	Temporal.PlainDateTime.from(iso).toString({ smallestUnit: "second" });
const compactDate = (iso: string) => iso.slice(0, 10).replaceAll("-", "");
const compactTime = (iso: string) =>
	second(iso).replaceAll("-", "").replaceAll(":", "");

/** Our recurrence as RRULE and EXDATE lines. */
export function formatGoogleRecurrence(
	e: Pick<CalendarEvent, "recurrence" | "allDay" | "timeZone">,
	zone: string,
): string[] {
	if (!e.recurrence) return [];
	const lines = [`RRULE:${e.recurrence.rrule}`];
	const ex = e.recurrence.exdates ?? [];
	if (ex.length)
		lines.push(
			e.allDay
				? `EXDATE;VALUE=DATE:${ex.map(compactDate).join(",")}`
				: `EXDATE;TZID=${e.timeZone ?? zone}:${ex.map(compactTime).join(",")}`,
		);
	return lines;
}

const time = (
	iso: string,
	e: Pick<CalendarEvent, "allDay" | "timeZone">,
	zone: string,
): GoogleEventTime =>
	e.allDay
		? { date: iso.slice(0, 10) }
		: { dateTime: second(iso), timeZone: e.timeZone ?? zone };

/** Every writable field of `e` as Google expects it. Timed events fall back to `zone`. */
export function toGoogleBody(e: CalendarEvent, zone: string): GoogleEventBody {
	const body: GoogleEventBody = {
		summary: e.title,
		description: e.description ?? "",
		location: e.location ?? "",
		start: time(e.start, e, zone),
		end: time(e.end, e, zone),
		transparency: e.busy === false ? "transparent" : "opaque",
		visibility: e.visibility ?? "default",
		reminders: e.reminders
			? {
					useDefault: false,
					overrides: e.reminders.map((minutes) => ({
						method: "popup" as const,
						minutes,
					})),
				}
			: { useDefault: true },
	};
	if (e.recurrence) body.recurrence = formatGoogleRecurrence(e, zone);
	if (e.attendees?.length)
		body.attendees = e.attendees.map((a) => ({
			email: a.email,
			...(a.name ? { displayName: a.name } : {}),
			...(a.rsvp ? { responseStatus: a.rsvp } : {}),
			...(a.resource ? { resource: true } : {}),
		}));
	return body;
}

/** The fields that differ between two bodies. Fields `after` dropped are cleared. */
function diff(before: GoogleEventBody, after: GoogleEventBody) {
	const out: Record<string, unknown> = {};
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const k of keys) {
		const a = after[k as keyof GoogleEventBody];
		const b = before[k as keyof GoogleEventBody];
		if (JSON.stringify(a) === JSON.stringify(b)) continue;
		out[k] = a ?? [];
	}
	return out as GoogleEventBody;
}

/**
 * Google's id for one occurrence of a series: the series id, `_`, then the original start as a UTC
 * basic-format time (or a date for all-day series).
 */
export function googleInstance(
	series: CalendarEvent,
	occurrence: string,
	zone: string,
): GoogleInstanceRef & { id: string } {
	const seriesId = eventToken(series);
	if (series.allDay)
		return {
			seriesId,
			id: `${seriesId}_${compactDate(occurrence)}`,
			originalStart: occurrence.slice(0, 10),
		};
	const instant = Temporal.PlainDateTime.from(occurrence)
		.toZonedDateTime(series.timeZone ?? zone)
		.toInstant()
		.toString({ smallestUnit: "second" });
	return {
		seriesId,
		id: `${seriesId}_${instant.replaceAll("-", "").replaceAll(":", "")}`,
		originalStart: instant,
	};
}

/** A series' occurrence at `occurrence`, as it is with no override. */
function occurrenceOf(series: CalendarEvent, occurrence: string) {
	const { recurrence: _r, ...rest } = series;
	const length = series.allDay
		? Temporal.PlainDate.from(series.start).until(
				Temporal.PlainDate.from(series.end),
			)
		: Temporal.PlainDateTime.from(series.start).until(
				Temporal.PlainDateTime.from(series.end),
			);
	const end = series.allDay
		? Temporal.PlainDate.from(occurrence).add(length).toString()
		: Temporal.PlainDateTime.from(occurrence).add(length).toString();
	return { ...rest, start: occurrence, end };
}

const othersInvited = (...es: (CalendarEvent | undefined)[]) =>
	es.some((e) => e?.attendees?.some((a) => !a.self && !a.resource));

const isOverride = (e: CalendarEvent) =>
	!!e.recurringEventId && e.originalStart !== undefined;

/**
 * The Google writes that make Google match a committed edit.
 *
 * `before` and `after` hold the events the edit touched (and the series of any override it
 * touched) as they were before and after it. `target` says where a calendar lives in Google, or
 * nothing for calendars that don't sync there. `zone` stands in for timed events with no zone.
 */
export function planGoogleWrites(
	result: EditResult,
	before: ReadonlyMap<string, CalendarEvent>,
	after: ReadonlyMap<string, CalendarEvent>,
	target: (calendarId: string) => GoogleTarget | undefined,
	zone: string,
): GoogleWrite[] {
	// A calendar change shows up as a removal plus a put under the new calendar's id, same token.
	const movedFrom = new Map<string, CalendarEvent>();
	for (const id of result.remove) {
		const b = before.get(id);
		if (!b || after.has(id)) continue;
		const a = result.put.find(
			(p) =>
				!before.has(p.id) &&
				p.calendarId !== b.calendarId &&
				eventToken(p) === eventToken(b),
		);
		if (a) movedFrom.set(a.id, b);
	}
	const consumed = new Set([...movedFrom.values()].map((b) => b.id));
	const ids = [
		...new Set([...result.put.map((e) => e.id), ...result.remove]),
	].filter((id) => !consumed.has(id));
	const pick = (id: string) => after.get(id) ?? before.get(id);
	// Series and single events first, so a new series exists before writes to its occurrences.
	ids.sort(
		(x, y) =>
			Number(isOverride(pick(x) as CalendarEvent)) -
			Number(isOverride(pick(y) as CalendarEvent)),
	);

	const out: GoogleWrite[] = [];
	for (const id of ids) {
		const a = after.get(id);
		const moved = movedFrom.get(id);
		const b = moved ?? before.get(id);
		const e = a ?? b;
		if (!e) continue;
		if (isOverride(e)) out.push(...overrideWrites(a, b, !!moved));
		else out.push(...eventWrites(a, b));
	}
	return out;

	function base(t: GoogleTarget, ...es: (CalendarEvent | undefined)[]) {
		return {
			...t,
			localIds: es.flatMap((e) => (e ? [e.id] : [])),
			notify: othersInvited(...es),
		};
	}

	function eventWrites(a?: CalendarEvent, b?: CalendarEvent): GoogleWrite[] {
		const ta = a && target(a.calendarId);
		const tb = b && target(b.calendarId);
		const insert = (t: GoogleTarget, e: CalendarEvent): GoogleWrite => ({
			...base(t, e),
			kind: "insert",
			body: { ...toGoogleBody(e, zone), id: eventToken(e) },
		});
		const remove = (t: GoogleTarget, e: CalendarEvent): GoogleWrite => ({
			...base(t, e),
			kind: "delete",
			eventId: eventToken(e),
		});
		if (a && b && a.calendarId !== b.calendarId) {
			if (ta && tb && ta.accountId === tb.accountId) {
				const body = diff(toGoogleBody(b, zone), toGoogleBody(a, zone));
				return [
					{
						...base(tb, a, b),
						kind: "move",
						eventId: eventToken(b),
						destination: ta.calendarId,
					},
					...(Object.keys(body).length
						? [
								{
									...base(ta, a),
									kind: "patch" as const,
									eventId: eventToken(a),
									body,
								},
							]
						: []),
				];
			}
			return [...(tb ? [remove(tb, b)] : []), ...(ta ? [insert(ta, a)] : [])];
		}
		if (a && !b) return ta ? [insert(ta, a)] : [];
		if (b && !a) return tb ? [remove(tb, b)] : [];
		if (!a || !b || !ta) return [];

		const writes: GoogleWrite[] = [];
		const body = diff(toGoogleBody(b, zone), toGoogleBody(a, zone));
		// Skipping one occurrence is a delete of that instance, not a rewrite of the series' rule.
		if (
			a.recurrence &&
			b.recurrence &&
			a.recurrence.rrule === b.recurrence.rrule
		) {
			delete body.recurrence;
			const was = new Set(b.recurrence.exdates ?? []);
			const now = new Set(a.recurrence.exdates ?? []);
			for (const x of now)
				if (!was.has(x)) {
					const { id: eventId, ...instance } = googleInstance(a, x, zone);
					writes.push({ ...base(ta, a), kind: "delete", eventId, instance });
				}
			for (const x of was)
				if (!now.has(x)) {
					const { id: eventId, ...instance } = googleInstance(a, x, zone);
					writes.push({
						...base(ta, a),
						kind: "patch",
						eventId,
						instance,
						body: { status: "confirmed" },
					});
				}
		}
		if (Object.keys(body).length)
			writes.unshift({
				...base(ta, a, b),
				kind: "patch",
				eventId: eventToken(a),
				body,
			});
		return writes;
	}

	function overrideWrites(
		a: CalendarEvent | undefined,
		b: CalendarEvent | undefined,
		moved: boolean,
	): GoogleWrite[] {
		const e = (a ?? b) as CalendarEvent;
		const t = target(e.calendarId);
		const seriesId = e.recurringEventId as string;
		const series = after.get(seriesId) ?? before.get(seriesId);
		if (!t || !series || e.originalStart === undefined) return [];
		const { id: eventId, ...instance } = googleInstance(
			series,
			e.originalStart,
			zone,
		);
		const strip = ({ recurrence: _r, ...body }: GoogleEventBody) => body;
		const bodyOf = (x: CalendarEvent) => strip(toGoogleBody(x, zone));

		if (a) {
			if (a.status === "cancelled")
				return [{ ...base(t, a), kind: "delete", eventId, instance }];
			const bt = b && target(b.calendarId);
			// The series moved within the account and took its exceptions along.
			if (moved && bt?.accountId === t.accountId) {
				const body = diff(bodyOf(b as CalendarEvent), bodyOf(a));
				return Object.keys(body).length
					? [{ ...base(t, a), kind: "patch", eventId, instance, body }]
					: [];
			}
			const body =
				b && !moved && b.status !== "cancelled"
					? diff(bodyOf(b), bodyOf(a))
					: { ...bodyOf(a), status: "confirmed" as const };
			return Object.keys(body).length
				? [{ ...base(t, a, b), kind: "patch", eventId, instance, body }]
				: [];
		}
		// Removed: the series is gone or skips this occurrence (its own writes cover that), or
		// the occurrence goes back to how the series has it.
		const now = after.get(seriesId);
		if (!now || now.recurrence?.exdates?.includes(e.originalStart)) return [];
		return [
			{
				...base(t, b),
				kind: "patch",
				eventId,
				instance,
				body: {
					...bodyOf(occurrenceOf(now, e.originalStart)),
					status: "confirmed",
				},
			},
		];
	}
}
