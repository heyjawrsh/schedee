/**
 * ICS feeds (RFC 5545) into our event model. Feeds are read-only snapshots: each fetch replaces
 * the calendar's events. Series keep their RRULE for our own engine to expand.
 */
import ICAL from "ical.js";
import { Temporal } from "temporal-polyfill";
import { overrideId } from "./edit";
import type { Attendee, CalendarEvent, Recurrence, Rsvp } from "./model";

type Time = InstanceType<typeof ICAL.Time>;
type Property = InstanceType<typeof ICAL.Property>;
export type Component = InstanceType<typeof ICAL.Component>;

export interface ParsedFeed {
	/** X-WR-CALNAME, if the feed names itself. */
	name?: string;
	/** RFC 7986 COLOR or Apple's calendar color, as hex. */
	color?: string;
	/** How often the feed asks to be fetched (REFRESH-INTERVAL or X-PUBLISHED-TTL). */
	refreshMinutes?: number;
	events: CalendarEvent[];
}

/** `webcal://` is plain HTTPS in disguise. Returns null for anything that isn't a web URL. */
export function feedUrl(input: string): string | null {
	const raw = input.trim().replace(/^webcals?:\/\//i, "https://");
	try {
		const u = new URL(raw);
		return u.protocol === "https:" || u.protocol === "http:"
			? u.toString()
			: null;
	} catch {
		return null;
	}
}

/** Windows zone names that Microsoft-made feeds use, for the common cases. */
const WINDOWS_ZONES: Record<string, string> = {
	"Eastern Standard Time": "America/New_York",
	"Central Standard Time": "America/Chicago",
	"Mountain Standard Time": "America/Denver",
	"US Mountain Standard Time": "America/Phoenix",
	"Pacific Standard Time": "America/Los_Angeles",
	"Alaskan Standard Time": "America/Anchorage",
	"Hawaiian Standard Time": "Pacific/Honolulu",
	"Atlantic Standard Time": "America/Halifax",
	"Canada Central Standard Time": "America/Regina",
	"Mexico Standard Time": "America/Mexico_City",
	"E. South America Standard Time": "America/Sao_Paulo",
	"Argentina Standard Time": "America/Buenos_Aires",
	"GMT Standard Time": "Europe/London",
	"Greenwich Standard Time": "Atlantic/Reykjavik",
	"W. Europe Standard Time": "Europe/Berlin",
	"Romance Standard Time": "Europe/Paris",
	"Central Europe Standard Time": "Europe/Budapest",
	"Central European Standard Time": "Europe/Warsaw",
	"E. Europe Standard Time": "Europe/Chisinau",
	"FLE Standard Time": "Europe/Kiev",
	"GTB Standard Time": "Europe/Bucharest",
	"Russian Standard Time": "Europe/Moscow",
	"Turkey Standard Time": "Europe/Istanbul",
	"Israel Standard Time": "Asia/Jerusalem",
	"South Africa Standard Time": "Africa/Johannesburg",
	"Arabian Standard Time": "Asia/Dubai",
	"India Standard Time": "Asia/Kolkata",
	"China Standard Time": "Asia/Shanghai",
	"Singapore Standard Time": "Asia/Singapore",
	"Tokyo Standard Time": "Asia/Tokyo",
	"Korea Standard Time": "Asia/Seoul",
	"AUS Eastern Standard Time": "Australia/Sydney",
	"E. Australia Standard Time": "Australia/Brisbane",
	"W. Australia Standard Time": "Australia/Perth",
	"New Zealand Standard Time": "Pacific/Auckland",
	UTC: "UTC",
};

const isZone = (z: string) => {
	try {
		Intl.DateTimeFormat("en", { timeZone: z });
		return true;
	} catch {
		return false;
	}
};

/** An IANA zone for a TZID: as is, a Windows name, or the tail of a prefixed id. */
export function resolveZone(tzid: string): string | undefined {
	const id = tzid.trim().replace(/^"|"$/g, "");
	if (isZone(id)) return id;
	const win = WINDOWS_ZONES[id];
	if (win) return win;
	// e.g. "/mozilla.org/20050126_1/America/New_York" or "/citadel.org/.../Europe/Paris"
	const tail = /([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(id)?.[1];
	return tail && isZone(tail) ? tail : undefined;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const dateOf = (t: Time) => `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;
const wallOf = (t: Time) =>
	`${dateOf(t)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;

/** A timed value as wall-clock time plus the IANA zone it's written in. */
interface Wall {
	wall: string;
	zone: string;
}

function wallTime(t: Time, prop: Property | null, fallback: string): Wall {
	const tzid = prop?.getParameter("tzid");
	const utc = t.zone?.tzid === "UTC";
	if (!utc && typeof tzid === "string") {
		const zone = resolveZone(tzid);
		if (zone) return { wall: wallOf(t), zone };
	}
	if (
		utc ||
		(typeof tzid === "string" && t.zone && t.zone.tzid !== "floating")
	) {
		// UTC, or a custom VTIMEZONE we can't name: go through the instant.
		const instant = Temporal.Instant.fromEpochMilliseconds(
			t.toUnixTime() * 1000,
		);
		return {
			wall: instant
				.toZonedDateTimeISO(fallback)
				.toPlainDateTime()
				.toString({ smallestUnit: "second" }),
			zone: fallback,
		};
	}
	// Floating time: the same wall clock wherever the viewer is.
	return { wall: wallOf(t), zone: fallback };
}

/** `w` rewritten in `zone`. */
const inZone = (w: Wall, zone: string) =>
	w.zone === zone
		? w.wall
		: Temporal.PlainDateTime.from(w.wall)
				.toZonedDateTime(w.zone)
				.withTimeZone(zone)
				.toPlainDateTime()
				.toString({ smallestUnit: "second" });

function minutesOf(v: unknown): number | undefined {
	if (v instanceof ICAL.Duration) return Math.round(v.toSeconds() / 60);
	if (typeof v === "string") {
		try {
			return Math.round(ICAL.Duration.fromString(v).toSeconds() / 60);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function colorOf(cal: Component): string | undefined {
	for (const name of ["color", "x-apple-calendar-color"]) {
		const v = cal.getFirstPropertyValue(name);
		if (typeof v === "string" && /^#[0-9a-f]{6}/i.test(v))
			return v.slice(0, 7).toUpperCase();
	}
	return undefined;
}

/** One VEVENT and the event it became. */
export interface IcsEntry {
	component: Component;
	event: CalendarEvent;
}

/**
 * Reads a calendar into events, keeping each one's VEVENT next to it so a writer can update the
 * original in place. Events that can't be read are skipped rather than failing the whole text.
 */
export function readIcs(
	text: string,
	calendarId: string,
	fallbackZone: string,
	key?: string,
): { calendar: Component; entries: IcsEntry[] } {
	const cal = new ICAL.Component(ICAL.parse(text));
	const entries: IcsEntry[] = [];
	const seen = new Map<string, number>();
	const seriesZone = new Map<string, { zone: string; allDay: boolean }>();
	const vevents = cal.getAllSubcomponents("vevent");
	// Series first, so overrides can be written in their series' zone.
	const ordered = [
		...vevents.filter((v) => !v.hasProperty("recurrence-id")),
		...vevents.filter((v) => v.hasProperty("recurrence-id")),
	];
	for (const v of ordered) {
		try {
			const e = mapVevent(v, calendarId, fallbackZone, seriesZone, key);
			if (!e) continue;
			// Broken feeds reuse UIDs; keep every event.
			const n = seen.get(e.id) ?? 0;
			seen.set(e.id, n + 1);
			entries.push({
				component: v,
				event: n ? { ...e, id: `${e.id}~${n}` } : e,
			});
		} catch {
			// Skip the event, keep the rest.
		}
	}
	return { calendar: cal, entries };
}

/** Parses a feed. Events that can't be read are skipped rather than failing the whole feed. */
export function parseIcs(
	text: string,
	calendarId: string,
	/** Stands in for floating times and zones we can't name. */
	fallbackZone: string,
	/**
	 * Names events after this key instead of their UID: a CalDAV resource holds one series, and
	 * its key is how a later sync finds it again.
	 */
	key?: string,
): ParsedFeed {
	const { calendar: cal, entries } = readIcs(
		text,
		calendarId,
		fallbackZone,
		key,
	);
	const name = cal.getFirstPropertyValue("x-wr-calname");
	const refresh =
		minutesOf(cal.getFirstPropertyValue("refresh-interval")) ??
		minutesOf(cal.getFirstPropertyValue("x-published-ttl"));
	const color = colorOf(cal);
	return {
		...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
		...(color ? { color } : {}),
		...(refresh && refresh > 0 ? { refreshMinutes: refresh } : {}),
		events: entries.map((e) => e.event),
	};
}

const RSVP: Record<string, Rsvp> = {
	ACCEPTED: "accepted",
	TENTATIVE: "tentative",
	DECLINED: "declined",
	"NEEDS-ACTION": "needsAction",
};
const mailbox = (p: Property | null) => {
	const v = p?.getFirstValue();
	return typeof v === "string"
		? v
				.replace(/^mailto:/i, "")
				.trim()
				.toLowerCase()
		: "";
};

/** Guests and organizer, so events someone else organizes stay read-only. */
function attendeesOf(v: Component): Attendee[] {
	const organizer = mailbox(v.getFirstProperty("organizer"));
	const out: Attendee[] = [];
	for (const p of v.getAllProperties("attendee")) {
		const email = mailbox(p);
		if (!email) continue;
		const cn = p.getParameter("cn");
		const stat = p.getParameter("partstat");
		const a: Attendee = { email };
		if (typeof cn === "string" && cn) a.name = cn;
		const rsvp =
			typeof stat === "string" ? RSVP[stat.toUpperCase()] : undefined;
		if (rsvp) a.rsvp = rsvp;
		if (email === organizer) a.organizer = true;
		if (String(p.getParameter("cutype") ?? "").toUpperCase() === "ROOM")
			a.resource = true;
		out.push(a);
	}
	if (organizer && out.length && !out.some((a) => a.organizer))
		out.unshift({ email: organizer, organizer: true });
	return out;
}

function mapVevent(
	v: Component,
	calendarId: string,
	fallback: string,
	seriesZone: Map<string, { zone: string; allDay: boolean }>,
	key: string | undefined,
): CalendarEvent | null {
	const ev = new ICAL.Event(v);
	if (!ev.uid || !ev.startDate) return null;
	const seriesId = `${calendarId}#${key ?? ev.uid}`;
	const startProp = v.getFirstProperty("dtstart");
	const start = ev.startDate;
	const allDay = start.isDate;
	const status = String(v.getFirstPropertyValue("status") ?? "").toUpperCase();
	const cancelled = status === "CANCELLED";
	const isOverride = v.hasProperty("recurrence-id");
	if (cancelled && !isOverride) return null;

	let startIso: string;
	let endIso: string;
	let zone: string | undefined;
	const end = ev.endDate;
	if (allDay) {
		startIso = dateOf(start);
		const e = end?.isDate ? dateOf(end) : startIso;
		endIso =
			e > startIso
				? e
				: Temporal.PlainDate.from(startIso).add({ days: 1 }).toString();
	} else {
		const s = wallTime(start, startProp, fallback);
		zone = s.zone;
		startIso = s.wall;
		const endProp = v.getFirstProperty("dtend");
		const e = end ? wallTime(end, endProp ?? startProp, fallback) : s;
		endIso = inZone(e, zone);
		if (endIso < startIso) endIso = startIso;
	}

	// Overrides are written like their series: its zone, its all-day-ness.
	let originalStart: string | undefined;
	if (isOverride) {
		const rid = ev.recurrenceId;
		const series = seriesZone.get(seriesId);
		const ridProp = v.getFirstProperty("recurrence-id");
		if (series?.allDay || rid.isDate) originalStart = dateOf(rid);
		else
			originalStart = inZone(
				wallTime(rid, ridProp, fallback),
				series?.zone ?? zone ?? fallback,
			);
	}

	let recurrence: Recurrence | undefined;
	const rrule = v.getFirstPropertyValue("rrule");
	if (!isOverride && rrule instanceof ICAL.Recur) {
		const exdates: string[] = [];
		for (const p of v.getAllProperties("exdate"))
			for (const t of p.getValues() as Time[]) {
				if (allDay || t.isDate) exdates.push(dateOf(t));
				else exdates.push(inZone(wallTime(t, p, fallback), zone ?? fallback));
			}
		recurrence = exdates.length
			? { rrule: rrule.toString(), exdates }
			: { rrule: rrule.toString() };
		seriesZone.set(seriesId, { zone: zone ?? fallback, allDay });
	}

	const transp = String(v.getFirstPropertyValue("transp") ?? "").toUpperCase();
	const text = (name: string) => {
		const t = v.getFirstPropertyValue(name);
		return typeof t === "string" && t.trim() ? t : undefined;
	};
	const out: CalendarEvent = {
		id:
			isOverride && originalStart
				? overrideId(seriesId, originalStart)
				: seriesId,
		calendarId,
		title: ev.summary ?? "",
		start: startIso,
		end: endIso,
		allDay,
	};
	if (zone) out.timeZone = zone;
	if (transp === "TRANSPARENT") out.busy = false;
	if (recurrence) out.recurrence = recurrence;
	if (isOverride) {
		out.recurringEventId = seriesId;
		if (originalStart) out.originalStart = originalStart;
	}
	if (cancelled) out.status = "cancelled";
	const location = text("location");
	if (location) out.location = location;
	const description = text("description");
	if (description) out.description = description;
	const attendees = attendeesOf(v);
	if (attendees.length) out.attendees = attendees;
	return out;
}
