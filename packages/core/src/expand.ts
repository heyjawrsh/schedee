import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";
import type { CalendarEvent, EventInstance } from "./model";

export interface DateRange {
	start: Temporal.PlainDate;
	/** Exclusive. */
	end: Temporal.PlainDate;
}

const compact = (dt: Temporal.PlainDateTime) =>
	dt
		.toString({ smallestUnit: "second" })
		.replaceAll("-", "")
		.replaceAll(":", "");

/** Moves a wall-clock time from one zone to another. */
export function convertZone(
	iso: string,
	from: string,
	to: string,
): Temporal.PlainDateTime {
	const dt = Temporal.PlainDateTime.from(iso);
	if (from === to) return dt;
	return dt
		.toZonedDateTime(from, { disambiguation: "compatible" })
		.withTimeZone(to)
		.toPlainDateTime();
}

function occurrenceStarts(
	event: CalendarEvent,
	zone: string,
	from: Temporal.ZonedDateTime,
	to: Temporal.ZonedDateTime,
) {
	const rec = event.recurrence;
	if (!rec) return [];
	const startDt = event.allDay
		? Temporal.PlainDate.from(event.start).toPlainDateTime()
		: Temporal.PlainDateTime.from(event.start);
	const tz = event.allDay ? "UTC" : zone;
	const rule = new RRuleTemporal({
		rruleString: `DTSTART;TZID=${tz}:${compact(startDt)}\nRRULE:${rec.rrule}`,
	});
	const exdates = new Set(
		(rec.exdates ?? []).map((d) =>
			event.allDay ? d.slice(0, 10) : Temporal.PlainDateTime.from(d).toString(),
		),
	);
	return rule
		.between(from.withTimeZone(tz), to.withTimeZone(tz), true)
		.map((z) => Temporal.ZonedDateTime.from(z.toString()).toPlainDateTime())
		.filter(
			(dt) =>
				!exdates.has(
					event.allDay ? dt.toPlainDate().toString() : dt.toString(),
				),
		);
}

/**
 * Turns stored events (singles, series masters, overrides) into the concrete instances that
 * touch `range`, with timed start/end converted into `viewZone`.
 */
export function expandEvents(
	events: CalendarEvent[],
	range: DateRange,
	viewZone: string,
): EventInstance[] {
	const overrides = new Map<string, CalendarEvent>();
	for (const e of events)
		if (e.recurringEventId && e.originalStart)
			overrides.set(`${e.recurringEventId}|${e.originalStart}`, e);

	// Pad the window by a day each side so zone shifts and long events are not missed.
	const from = range.start
		.subtract({ days: 1 })
		.toZonedDateTime({ timeZone: viewZone });
	const to = range.end.add({ days: 1 }).toZonedDateTime({ timeZone: viewZone });
	const out: EventInstance[] = [];

	const place = (
		e: CalendarEvent,
		id: string,
		sourceId: string,
		occurrence?: string,
	) => {
		if (e.status === "cancelled") return;
		if (e.allDay) {
			const s = Temporal.PlainDate.from(e.start);
			const en = Temporal.PlainDate.from(e.end);
			if (
				Temporal.PlainDate.compare(en, range.start) <= 0 ||
				Temporal.PlainDate.compare(s, range.end) >= 0
			)
				return;
			out.push({ ...e, id, sourceId, ...(occurrence ? { occurrence } : {}) });
			return;
		}
		const zone = e.timeZone ?? viewZone;
		const s = convertZone(e.start, zone, viewZone);
		const en = convertZone(e.end, zone, viewZone);
		if (
			Temporal.PlainDateTime.compare(en, range.start.toPlainDateTime()) <= 0 ||
			Temporal.PlainDateTime.compare(s, range.end.toPlainDateTime()) >= 0
		)
			return;
		out.push({
			...e,
			id,
			sourceId,
			...(occurrence ? { occurrence } : {}),
			start: s.toString(),
			end: en.toString(),
			timeZone: viewZone,
		});
	};

	for (const e of events) {
		if (e.recurringEventId) continue; // placed via its series below (or skipped if the series is gone)
		if (!e.recurrence) {
			place(e, e.id, e.id);
			continue;
		}
		const zone = e.timeZone ?? viewZone;
		const duration = e.allDay
			? Temporal.PlainDate.from(e.start).until(Temporal.PlainDate.from(e.end))
			: Temporal.PlainDateTime.from(e.start).until(
					Temporal.PlainDateTime.from(e.end),
				);
		for (const startDt of occurrenceStarts(e, zone, from, to)) {
			const key = e.allDay
				? startDt.toPlainDate().toString()
				: startDt.toString();
			const override = overrides.get(`${e.id}|${key}`);
			const id = `${e.id}@${key}`;
			if (override) {
				const { recurrence: _ignored, ...single } = override;
				place(single, id, e.id, key);
				continue;
			}
			const occurrence: CalendarEvent = e.allDay
				? {
						...e,
						start: startDt.toPlainDate().toString(),
						end: startDt.toPlainDate().add(duration).toString(),
					}
				: {
						...e,
						start: startDt.toString(),
						end: startDt.add(duration).toString(),
					};
			place(occurrence, id, e.id, key);
		}
	}
	return out;
}
