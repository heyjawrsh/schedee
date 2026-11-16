/** A calendar color as shown on the sidebar swatch, in light and dark themes. */
export interface CalendarColor {
	light: string;
	dark: string;
}

export interface Calendar {
	id: string;
	name: string;
	/** Light-theme hex; the dark variant is derived unless given. */
	color: string;
	colorDark?: string;
	hidden?: boolean;
	/** The account's default calendar for new events. */
	isDefault?: boolean;
	/** Read-only subscriptions (ICS feeds, holidays, birthdays) draw a feed glyph on the swatch. */
	subscribed?: boolean;
	/** Events can be shown but not changed here (a calendar we can only read so far). */
	readOnly?: boolean;
	/** Set while this calendar can't be loaded (a feed that fails to fetch or parse). */
	problem?: "sync_failed";
}

export interface Account {
	id: string;
	/** Usually the account email. */
	label: string;
	calendars: Calendar[];
	/**
	 * Where the account syncs from: Google, a CalDAV server (iCloud and others), or "ics" for the
	 * group holding feed subscriptions. Absent for calendars that live only on this device.
	 */
	provider?: "google" | "caldav" | "ics";
	/**
	 * Set while syncing needs attention: the sign-in expired or was revoked, or syncing keeps
	 * failing for another reason. Cleared by the next good sync.
	 */
	problem?: "signed_out" | "sync_failed";
	/** Edits the provider refused for good since the user last dismissed the notice. */
	dropped?: number;
}

export type Rsvp = "accepted" | "tentative" | "needsAction" | "declined";

export interface CalendarEvent {
	id: string;
	calendarId: string;
	title: string;
	/** All-day: ISO date. Timed: ISO date-time without offset, in the view's time zone. */
	start: string;
	/** Exclusive. All-day: ISO date. Timed: ISO date-time. */
	end: string;
	allDay: boolean;
	/** False for "free" time. Long free events draw as a ribbon. Defaults to true. */
	busy?: boolean;
	rsvp?: Rsvp;
	glyph?: "gift";
	/** IANA zone the timed start/end are written in. Defaults to the snapshot's zone. */
	timeZone?: string;
	/** Present on a series master. */
	recurrence?: Recurrence;
	/** Present on a single-instance override: the series it belongs to... */
	recurringEventId?: string;
	/** ...and the start of the occurrence it replaces, in the series' own format and zone. */
	originalStart?: string;
	/** A cancelled override hides its occurrence. */
	status?: "confirmed" | "cancelled";
	location?: string;
	description?: string;
	createdBy?: string;
	attendees?: Attendee[];
	conference?: Conference;
	visibility?: "default" | "public" | "private";
	/** Minutes before start. */
	reminders?: number[];
}

export interface Attendee {
	email: string;
	name?: string;
	rsvp?: Rsvp;
	organizer?: boolean;
	/** The signed-in user. */
	self?: boolean;
	/** Rooms and other resources. */
	resource?: boolean;
}

export interface Conference {
	kind: "zoom" | "meet" | "teams" | "other";
	url: string;
	/** Meeting ID or short label shown next to the provider name. */
	label?: string;
}

export interface Recurrence {
	/** RFC 5545 RRULE value without the "RRULE:" prefix, e.g. "FREQ=WEEKLY;BYDAY=MO,WE". */
	rrule: string;
	/** Occurrence starts to skip, in the same format and zone as `start`. */
	exdates?: string[];
}

/** A concrete, displayable occurrence in the viewer's zone. */
export interface EventInstance extends CalendarEvent {
	/** The series (or single event) this instance comes from. */
	sourceId: string;
	/** For occurrences of a series: the original start key (series format and zone). */
	occurrence?: string;
}

/** A static snapshot of everything the week view needs to render. */
export interface CalendarSnapshot {
	/** Frozen "now", ISO date-time without offset, in `timeZone`. */
	now: string;
	timeZone: string;
	/** Short label shown in the time gutter, e.g. "CST". */
	timeZoneLabel: string;
	accounts: Account[];
	events: CalendarEvent[];
}
