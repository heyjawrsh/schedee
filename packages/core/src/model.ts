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
}

export interface Account {
	id: string;
	/** Usually the account email. */
	label: string;
	calendars: Calendar[];
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
