import {
	type CalendarEvent,
	type CalendarSnapshot,
	Temporal,
	weekOf,
} from "@schedee/core";

/** Invented calendars and events around the current week, for the public build and tests. */
export function demoSnapshot(
	now: Temporal.ZonedDateTime = Temporal.Now.zonedDateTimeISO(),
): CalendarSnapshot {
	const days = weekOf(now.toPlainDate()).days;
	const day = (i: number) => (days[i] ?? days[0])?.toString() ?? "";
	let n = 0;
	const timed = (
		i: number,
		start: string,
		end: string,
		calendarId: string,
		title: string,
		extra: Partial<CalendarEvent> = {},
	) => ({
		id: `e${++n}`,
		calendarId,
		title,
		start: `${day(i)}T${start}`,
		end: `${day(i)}T${end}`,
		allDay: false,
		...extra,
	});
	const allDay = (
		i: number,
		span: number,
		calendarId: string,
		title: string,
		extra: Partial<CalendarEvent> = {},
	) => ({
		id: `e${++n}`,
		calendarId,
		title,
		start: day(i),
		end: Temporal.PlainDate.from(day(i)).add({ days: span }).toString(),
		allDay: true,
		...extra,
	});

	const events: CalendarEvent[] = [
		allDay(0, 5, "team", "Design sprint"),
		allDay(0, 2, "team", "Priya out"),
		allDay(1, 1, "birthdays", "Sam Rivera’s birthday", { glyph: "gift" }),
		allDay(4, 1, "personal", "Ship v1"),
		allDay(6, 1, "personal", "Farmers market"),
	];
	for (let i = 0; i < 5; i++) {
		events.push(
			timed(i, "10:00", "16:00", "focus", "Deep work", {
				busy: false,
				rsvp: i === 0 ? "needsAction" : "tentative",
			}),
		);
		events.push(timed(i, "10:15", "10:30", "team", "Standup"));
	}
	events.push(
		timed(
			1,
			"08:30",
			"10:00",
			"team",
			"Quarterly planning with the platform group",
		),
		timed(1, "10:45", "11:00", "work", "Design sync"),
		timed(2, "11:30", "11:45", "work", "Check-in"),
		timed(3, "11:00", "12:00", "work", "Roadmap review"),
		timed(3, "12:00", "12:30", "work", "Partner call", { rsvp: "tentative" }),
		timed(4, "12:00", "14:00", "team", "Bug bash"),
		timed(4, "12:00", "13:00", "work", "Lunch and learn"),
		timed(5, "09:00", "10:30", "personal", "Long run"),
	);

	return {
		now: now.toPlainDateTime().toString({ smallestUnit: "second" }),
		timeZone: now.timeZoneId,
		timeZoneLabel: "LOCAL",
		accounts: [
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
		],
		events,
	};
}
