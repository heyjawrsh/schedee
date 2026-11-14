/**
 * Writes our events back into an iCalendar resource for CalDAV. Starts from the server's copy, so
 * everything we don't model (alarms, guests, Apple's own properties) survives; only the fields
 * Schedee edits are rewritten. Pure: the app sends what this returns.
 */
import ICAL from "ical.js";
import { Temporal } from "temporal-polyfill";
import { type Component, readIcs, resolveZone } from "./ics";
import type { CalendarEvent } from "./model";

type Time = InstanceType<typeof ICAL.Time>;

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
const offset = (ns: number) => {
	const min = Math.round(ns / 60e9);
	return `${min < 0 ? "-" : "+"}${pad(Math.trunc(Math.abs(min) / 60))}${pad(Math.abs(min) % 60)}`;
};
const compact = (dt: Temporal.PlainDateTime) =>
	dt
		.toString({ smallestUnit: "second" })
		.replaceAll("-", "")
		.replaceAll(":", "");

/**
 * A VTIMEZONE for an IANA zone, built from its real transitions (2000 to 2037): one STANDARD or
 * DAYLIGHT block per kind of change, with the rest of its dates as RDATEs.
 */
export function vtimezone(zone: string): Component {
	const end = Temporal.ZonedDateTime.from({
		timeZone: zone,
		year: 2038,
		month: 1,
		day: 1,
	});
	let at = Temporal.ZonedDateTime.from({
		timeZone: zone,
		year: 2000,
		month: 1,
		day: 1,
	});
	const groups = new Map<
		string,
		{ kind: string; from: string; to: string; walls: string[] }
	>();
	for (;;) {
		const next = at.getTimeZoneTransition("next");
		if (!next || Temporal.ZonedDateTime.compare(next, end) >= 0) break;
		const fromNs = next.subtract({ nanoseconds: 1 }).offsetNanoseconds;
		const toNs = next.offsetNanoseconds;
		// The local time the change happens at, on the clock before it.
		const wall = compact(
			next
				.toInstant()
				.add({ nanoseconds: fromNs })
				.toZonedDateTimeISO("UTC")
				.toPlainDateTime(),
		);
		const kind = toNs > fromNs ? "DAYLIGHT" : "STANDARD";
		const k = `${kind}|${fromNs}|${toNs}`;
		const g = groups.get(k);
		if (g) g.walls.push(wall);
		else
			groups.set(k, {
				kind,
				from: offset(fromNs),
				to: offset(toNs),
				walls: [wall],
			});
		at = next;
	}
	if (!groups.size) {
		const o = offset(at.offsetNanoseconds);
		groups.set("fixed", {
			kind: "STANDARD",
			from: o,
			to: o,
			walls: ["19700101T000000"],
		});
	}
	const lines = ["BEGIN:VTIMEZONE", `TZID:${zone}`];
	for (const g of groups.values()) {
		const [first, ...rest] = g.walls;
		lines.push(`BEGIN:${g.kind}`, `DTSTART:${first}`);
		if (rest.length) lines.push(`RDATE:${rest.join(",")}`);
		lines.push(`TZOFFSETFROM:${g.from}`, `TZOFFSETTO:${g.to}`, `END:${g.kind}`);
	}
	lines.push("END:VTIMEZONE");
	return new ICAL.Component(ICAL.parse(lines.join("\r\n")));
}

function timeOf(iso: string, allDay: boolean): Time {
	return allDay
		? ICAL.Time.fromDateString(iso.slice(0, 10))
		: ICAL.Time.fromDateTimeString(
				Temporal.PlainDateTime.from(iso).toString({ smallestUnit: "second" }),
			);
}

/** The TZID to write for `zone`: the property's own, if it already names that zone. */
function tzidFor(comp: Component, name: string, zone: string): string {
	const p = comp.getFirstProperty(name)?.getParameter("tzid");
	return typeof p === "string" && resolveZone(p) === zone ? p : zone;
}

function setTimes(
	comp: Component,
	name: string,
	values: string[],
	allDay: boolean,
	tzid: string | undefined,
) {
	comp.removeAllProperties(name);
	if (!values.length) return;
	const p = new ICAL.Property(name);
	p.resetType(allDay ? "date" : "date-time");
	if (values.length === 1) p.setValue(timeOf(values[0] ?? "", allDay));
	else p.setValues(values.map((v) => timeOf(v, allDay)));
	if (!allDay && tzid) p.setParameter("tzid", tzid);
	comp.addProperty(p);
}

function setText(comp: Component, name: string, value: string | undefined) {
	if (value) comp.updatePropertyWithValue(name, value);
	else comp.removeAllProperties(name);
}

const stamp = (now: Date) => ICAL.Time.fromJSDate(now, true);

export interface CalendarObjectInput {
	/** The server's copy, when the resource exists. */
	original?: string | undefined;
	calendarId: string;
	/** The resource's key; its events are `${calendarId}#${key}` and overrides of it. */
	key: string;
	/** The resource's events as they are now on this device: a series or single, and overrides. */
	events: CalendarEvent[];
	fallbackZone: string;
	now?: Date;
}

/** The resource's new text: the original with our changes, or a fresh calendar. */
export function writeCalendarObject(input: CalendarObjectInput): string {
	const { calendarId, key, events, fallbackZone } = input;
	const now = input.now ?? new Date();
	const resourceId = `${calendarId}#${key}`;
	let calendar: Component;
	let byId = new Map<string, Component>();
	if (input.original) {
		const read = readIcs(input.original, calendarId, fallbackZone, key);
		calendar = read.calendar;
		byId = new Map(read.entries.map((e) => [e.event.id, e.component]));
	} else {
		calendar = new ICAL.Component("vcalendar");
		calendar.addPropertyWithValue("version", "2.0");
		calendar.addPropertyWithValue("prodid", "-//Schedee//Schedee//EN");
		calendar.addPropertyWithValue("calscale", "GREGORIAN");
	}
	const local = new Set(events.map((e) => e.id));
	for (const [id, comp] of byId)
		if (!local.has(id)) calendar.removeSubcomponent(comp);

	const uid =
		[...byId.values()][0]?.getFirstPropertyValue("uid")?.toString() ??
		`${key}@sched.ee`;
	const master = events.find((e) => e.id === resourceId);
	// The series first, so overrides can take its zone.
	const ordered = [
		...events.filter((e) => !e.recurringEventId),
		...events.filter((e) => e.recurringEventId),
	];
	let masterTzid: string | undefined;
	const zones = new Set<string>();

	for (const e of ordered) {
		let comp = byId.get(e.id);
		if (!comp) {
			comp = new ICAL.Component("vevent");
			comp.addPropertyWithValue("uid", uid);
			calendar.addSubcomponent(comp);
		}
		const zone = e.timeZone ?? fallbackZone;
		const tzid = e.allDay ? undefined : tzidFor(comp, "dtstart", zone);
		if (tzid === zone && !e.allDay) zones.add(zone);
		setTimes(comp, "dtstart", [e.start], e.allDay, tzid);
		comp.removeAllProperties("duration");
		setTimes(comp, "dtend", [e.end], e.allDay, tzid);
		comp.updatePropertyWithValue("summary", e.title);
		setText(comp, "location", e.location);
		setText(comp, "description", e.description);
		if (e.busy === false) comp.updatePropertyWithValue("transp", "TRANSPARENT");
		else comp.removeAllProperties("transp");

		if (e.recurringEventId) {
			if (!comp.hasProperty("recurrence-id") && e.originalStart) {
				const seriesAllDay = master?.allDay ?? e.allDay;
				const seriesZone = master?.timeZone ?? fallbackZone;
				setTimes(
					comp,
					"recurrence-id",
					[e.originalStart],
					seriesAllDay,
					seriesAllDay ? undefined : (masterTzid ?? seriesZone),
				);
				if (!seriesAllDay && !masterTzid) zones.add(seriesZone);
			}
			if (e.status === "cancelled")
				comp.updatePropertyWithValue("status", "CANCELLED");
			else if (
				String(comp.getFirstPropertyValue("status")).toUpperCase() ===
				"CANCELLED"
			)
				comp.removeAllProperties("status");
		} else {
			masterTzid = tzid;
			comp.removeAllProperties("rrule");
			if (e.recurrence) {
				comp.addPropertyWithValue(
					"rrule",
					ICAL.Recur.fromString(e.recurrence.rrule),
				);
				setTimes(comp, "exdate", e.recurrence.exdates ?? [], e.allDay, tzid);
			} else comp.removeAllProperties("exdate");
		}

		const seq = Number(comp.getFirstPropertyValue("sequence") ?? 0);
		comp.updatePropertyWithValue(
			"sequence",
			Number.isFinite(seq) ? seq + 1 : 1,
		);
		comp.updatePropertyWithValue("dtstamp", stamp(now));
		comp.updatePropertyWithValue("last-modified", stamp(now));
	}

	const defined = new Set(
		calendar
			.getAllSubcomponents("vtimezone")
			.map((t) => String(t.getFirstPropertyValue("tzid"))),
	);
	for (const z of zones)
		if (!defined.has(z) && z !== "UTC") calendar.addSubcomponent(vtimezone(z));
	// Zones ahead of the events that use them, as most clients write it.
	const parts = calendar.jCal[2] as [string, ...unknown[]][];
	parts.sort(
		(a, b) => Number(a[0] !== "vtimezone") - Number(b[0] !== "vtimezone"),
	);
	return calendar.toString();
}
