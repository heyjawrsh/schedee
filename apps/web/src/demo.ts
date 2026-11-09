import type { Account, CalendarEvent, CalendarSnapshot } from "@schedee/core";

/**
 * Invented calendars and events for the public build, written as recurring series anchored in the
 * past so a one-time seed stays current week after week.
 */
export function demoSeed(): Pick<CalendarSnapshot, "accounts" | "events"> {
	const accounts: Account[] = [
		{
			id: "work",
			label: "you@example.com",
			calendars: [
				{
					id: "work",
					name: "you@example.com",
					color: "#FF08FF",
					colorDark: "#FF45FF",
				},
				{ id: "team", name: "Team", color: "#757AFF", colorDark: "#7D85FF" },
				{
					id: "ooo",
					name: "Out of office",
					color: "#757AFF",
					colorDark: "#7D85FF",
					hidden: true,
				},
			],
		},
		{
			id: "home",
			label: "you@example.org",
			calendars: [
				{
					id: "personal",
					name: "Personal",
					color: "#9808FF",
					colorDark: "#973BFF",
				},
				{
					id: "focus",
					name: "Focus",
					color: "#00FBFE",
					colorDark: "#1FFFFF",
					isDefault: true,
				},
				{
					id: "birthdays",
					name: "Birthdays",
					color: "#48CA80",
					colorDark: "#63D18D",
					subscribed: true,
				},
			],
		},
	];

	const series = (
		id: string,
		calendarId: string,
		title: string,
		date: string,
		start: string,
		end: string,
		rrule: string,
		extra: Partial<CalendarEvent> = {},
	): CalendarEvent => ({
		id,
		calendarId,
		title,
		start: `${date}T${start}`,
		end: `${date}T${end}`,
		allDay: false,
		recurrence: { rrule },
		...extra,
	});
	const allDaySeries = (
		id: string,
		calendarId: string,
		title: string,
		start: string,
		end: string,
		rrule: string,
		extra: Partial<CalendarEvent> = {},
	): CalendarEvent => ({
		id,
		calendarId,
		title,
		start,
		end,
		allDay: true,
		recurrence: { rrule },
		...extra,
	});

	// 2026-01-05 is a Monday; weekday-specific series start on the matching day that week.
	const events: CalendarEvent[] = [
		series(
			"standup",
			"team",
			"Standup",
			"2026-01-05",
			"10:15",
			"10:30",
			"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
		),
		series(
			"focus",
			"focus",
			"Deep work",
			"2026-01-05",
			"10:00",
			"16:00",
			"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
			{
				busy: false,
				rsvp: "tentative",
			},
		),
		series(
			"sync",
			"work",
			"Design sync",
			"2026-01-06",
			"10:45",
			"11:00",
			"FREQ=WEEKLY",
		),
		series(
			"checkin",
			"work",
			"Check-in",
			"2026-01-07",
			"11:30",
			"11:45",
			"FREQ=WEEKLY",
		),
		series(
			"london",
			"work",
			"Call with the London office",
			"2026-01-07",
			"15:00",
			"15:30",
			"FREQ=WEEKLY",
			{
				timeZone: "Europe/London",
			},
		),
		series(
			"roadmap",
			"work",
			"Roadmap review",
			"2026-01-08",
			"11:00",
			"12:00",
			"FREQ=WEEKLY",
		),
		series(
			"partner",
			"work",
			"Partner call",
			"2026-01-08",
			"12:00",
			"12:30",
			"FREQ=WEEKLY",
			{ rsvp: "tentative" },
		),
		series(
			"bugbash",
			"team",
			"Bug bash",
			"2026-01-09",
			"12:00",
			"14:00",
			"FREQ=WEEKLY",
		),
		series(
			"lunch",
			"work",
			"Lunch and learn",
			"2026-01-09",
			"12:00",
			"13:00",
			"FREQ=WEEKLY",
		),
		series(
			"run",
			"personal",
			"Long run",
			"2026-01-10",
			"09:00",
			"10:30",
			"FREQ=WEEKLY",
		),
		series(
			"planning",
			"team",
			"Quarterly planning with the platform group",
			"2026-01-13",
			"08:30",
			"10:00",
			"FREQ=MONTHLY;BYDAY=2TU",
		),
		allDaySeries(
			"sprint",
			"team",
			"Design sprint",
			"2026-01-05",
			"2026-01-10",
			"FREQ=WEEKLY;INTERVAL=2",
		),
		allDaySeries(
			"market",
			"personal",
			"Farmers market",
			"2026-01-10",
			"2026-01-11",
			"FREQ=WEEKLY",
		),
		allDaySeries(
			"payday",
			"work",
			"Payday",
			"2026-01-15",
			"2026-01-16",
			"FREQ=MONTHLY",
		),
		allDaySeries(
			"sam",
			"birthdays",
			"Sam Rivera’s birthday",
			"2000-11-10",
			"2000-11-11",
			"FREQ=YEARLY",
			{ glyph: "gift" },
		),
		allDaySeries(
			"priya",
			"birthdays",
			"Priya Shah’s birthday",
			"2000-03-02",
			"2000-03-03",
			"FREQ=YEARLY",
			{ glyph: "gift" },
		),
	];
	return { accounts, events };
}
