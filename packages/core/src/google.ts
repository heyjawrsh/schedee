import { Temporal } from "temporal-polyfill";
import type {
	Attendee,
	Calendar,
	CalendarEvent,
	Conference,
	Recurrence,
	Rsvp,
} from "./model";

// The subset of Google Calendar API v3 resources Schedee reads.

export interface GoogleCalendarListEntry {
	id: string;
	summary: string;
	summaryOverride?: string;
	backgroundColor?: string;
	primary?: boolean;
	accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
	selected?: boolean;
	timeZone?: string;
	deleted?: boolean;
}

export interface GoogleEventTime {
	date?: string;
	dateTime?: string;
	timeZone?: string;
}

interface GooglePerson {
	email?: string;
	displayName?: string;
	self?: boolean;
}

export interface GoogleEvent {
	id: string;
	status?: "confirmed" | "tentative" | "cancelled";
	summary?: string;
	description?: string;
	location?: string;
	start?: GoogleEventTime;
	end?: GoogleEventTime;
	recurrence?: string[];
	recurringEventId?: string;
	originalStartTime?: GoogleEventTime;
	transparency?: "opaque" | "transparent";
	visibility?: "default" | "public" | "private" | "confidential";
	attendees?: (GooglePerson & {
		responseStatus?: Rsvp;
		organizer?: boolean;
		resource?: boolean;
	})[];
	organizer?: GooglePerson;
	creator?: GooglePerson;
	hangoutLink?: string;
	conferenceData?: {
		conferenceId?: string;
		conferenceSolution?: { key?: { type?: string }; name?: string };
		entryPoints?: {
			entryPointType: string;
			uri: string;
			meetingCode?: string;
			label?: string;
		}[];
	};
	reminders?: {
		useDefault?: boolean;
		overrides?: { method: string; minutes: number }[];
	};
	eventType?: string;
}

/** Our calendar id for a Google calendar seen through one account (a shared calendar can appear in two). */
export const googleCalendarKey = (accountId: string, calendarId: string) =>
	`${accountId}/${calendarId}`;
/** Our event id: Google event ids are only unique within a calendar. */
export const googleEventKey = (calendarKey: string, eventId: string) =>
	`${calendarKey}#${eventId}`;

export function mapGoogleCalendar(
	entry: GoogleCalendarListEntry,
	accountId: string,
): Calendar {
	return clean<Calendar>({
		id: googleCalendarKey(accountId, entry.id),
		name: entry.summaryOverride ?? entry.summary,
		color: entry.backgroundColor ?? "#B3B4B4",
		isDefault: entry.primary || undefined,
		subscribed:
			entry.accessRole === "reader" || entry.accessRole === "freeBusyReader"
				? true
				: undefined,
		hidden: entry.selected === false || undefined,
	});
}

/** A Google date-time (with offset) as wall-clock time in `zone`. */
export const wallClock = (dateTime: string, zone: string) =>
	Temporal.Instant.from(dateTime)
		.toZonedDateTimeISO(zone)
		.toPlainDateTime()
		.toString({ smallestUnit: "second" });

const compactToIso = (v: string) => {
	// 20261110 or 20261110T090000 (optionally Z)
	const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
	if (!m) return null;
	const date = `${m[1]}-${m[2]}-${m[3]}`;
	if (!m[4]) return { date };
	const time = `${date}T${m[4]}:${m[5]}:${m[6]}`;
	return { time, utc: !!m[7] };
};

/** RRULE and EXDATE lines to our recurrence, with exdates written like the series start. */
export function parseGoogleRecurrence(
	lines: string[],
	allDay: boolean,
	zone: string,
): Recurrence | undefined {
	let rrule: string | undefined;
	const exdates: string[] = [];
	for (const line of lines) {
		const [head = "", value = ""] = line.split(/:(.*)/s);
		const [name = "", ...params] = head.split(";");
		if (name.toUpperCase() === "RRULE") rrule = value;
		if (name.toUpperCase() !== "EXDATE") continue;
		const tzid = params
			.find((p) => p.toUpperCase().startsWith("TZID="))
			?.slice(5);
		for (const raw of value.split(",")) {
			const v = compactToIso(raw.trim());
			if (!v) continue;
			if (allDay) {
				exdates.push(v.date ?? v.time?.slice(0, 10) ?? "");
			} else if (v.time) {
				const from = v.utc ? "UTC" : (tzid ?? zone);
				exdates.push(
					from === zone
						? v.time
						: Temporal.PlainDateTime.from(v.time)
								.toZonedDateTime(from)
								.withTimeZone(zone)
								.toPlainDateTime()
								.toString({ smallestUnit: "second" }),
				);
			}
		}
	}
	if (!rrule) return undefined;
	return exdates.length ? { rrule, exdates } : { rrule };
}

const RSVP: Rsvp[] = ["accepted", "tentative", "needsAction", "declined"];
const rsvpOf = (s: string | undefined): Rsvp | undefined =>
	RSVP.includes(s as Rsvp) ? (s as Rsvp) : undefined;

function conferenceOf(e: GoogleEvent): Conference | undefined {
	const video = e.conferenceData?.entryPoints?.find(
		(p) => p.entryPointType === "video",
	);
	const url = video?.uri ?? e.hangoutLink;
	if (!url) return undefined;
	const type = e.conferenceData?.conferenceSolution?.key?.type;
	const name = e.conferenceData?.conferenceSolution?.name?.toLowerCase() ?? "";
	const kind: Conference["kind"] =
		type === "hangoutsMeet" || (!e.conferenceData && e.hangoutLink)
			? "meet"
			: name.includes("zoom") || url.includes("zoom.us")
				? "zoom"
				: name.includes("teams") || url.includes("teams.microsoft")
					? "teams"
					: "other";
	const label = video?.meetingCode ?? e.conferenceData?.conferenceId;
	return label ? { kind, url, label } : { kind, url };
}

/** Removes undefined fields so stored records stay small and comparable. */
function clean<T extends object>(
	o: {
		[K in keyof T]?: T[K] | undefined;
	},
): T {
	const out = { ...o } as Record<string, unknown>;
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as T;
}

/**
 * Maps one Google event into our model. Returns null for a deleted event (a cancelled event that
 * isn't an exception of a series); the caller removes it from the store.
 */
export function mapGoogleEvent(
	e: GoogleEvent,
	calendarKey: string,
	calendarZone: string,
): CalendarEvent | null {
	const id = googleEventKey(calendarKey, e.id);
	const cancelled = e.status === "cancelled";
	if (cancelled && !e.recurringEventId) return null;

	const allDay = !!(e.start?.date ?? e.originalStartTime?.date);
	const zone =
		e.start?.timeZone ?? e.originalStartTime?.timeZone ?? calendarZone;
	const time = (t: GoogleEventTime | undefined) =>
		allDay ? t?.date : t?.dateTime ? wallClock(t.dateTime, zone) : undefined;

	const original = e.originalStartTime;
	const originalStart = original
		? (original.date ??
			(original.dateTime
				? wallClock(original.dateTime, original.timeZone ?? zone)
				: undefined))
		: undefined;
	const start = time(e.start) ?? originalStart ?? "";
	const end = time(e.end) ?? start;

	const self = e.attendees?.find((a) => a.self);
	const attendees: Attendee[] | undefined = e.attendees?.map((a) =>
		clean<Attendee>({
			email: a.email ?? "",
			name: a.displayName,
			rsvp: rsvpOf(a.responseStatus),
			organizer: a.organizer || undefined,
			self: a.self || undefined,
			resource: a.resource || undefined,
		}),
	);
	const reminders = e.reminders?.useDefault
		? undefined
		: e.reminders?.overrides?.map((r) => r.minutes);

	return clean<CalendarEvent>({
		id,
		calendarId: calendarKey,
		title: e.summary ?? "",
		start,
		end,
		allDay,
		timeZone: allDay ? undefined : zone,
		busy: e.transparency === "transparent" ? false : undefined,
		rsvp: rsvpOf(self?.responseStatus),
		glyph: e.eventType === "birthday" ? ("gift" as const) : undefined,
		recurrence: e.recurrence
			? parseGoogleRecurrence(e.recurrence, allDay, zone)
			: undefined,
		recurringEventId: e.recurringEventId
			? googleEventKey(calendarKey, e.recurringEventId)
			: undefined,
		originalStart: e.recurringEventId ? originalStart : undefined,
		status: cancelled ? ("cancelled" as const) : undefined,
		location: e.location || undefined,
		description: e.description || undefined,
		createdBy: e.organizer?.email ?? e.creator?.email,
		attendees: attendees?.length ? attendees : undefined,
		conference: conferenceOf(e),
		visibility:
			e.visibility === "confidential"
				? ("private" as const)
				: e.visibility === "default"
					? undefined
					: e.visibility,
		reminders: reminders?.length ? reminders : undefined,
	});
}
