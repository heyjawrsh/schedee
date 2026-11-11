import {
	type Calendar,
	goTo,
	parseDate,
	setView,
	step,
	type Temporal,
	type ViewState,
} from "@schedee/core";
import type { CommandGroup, CommandItem } from "./CommandMenu";

export type ThemeChoice = "light" | "dark" | "system";

export interface CommandContext {
	view: ViewState;
	today: Temporal.PlainDate;
	setView: (f: (v: ViewState) => ViewState) => void;
	/** Creates an event now; absent when nothing is writable. */
	createEvent?: (() => void) | undefined;
	/** Puts the cursor in the search field. */
	search?: (() => void) | undefined;
	calendars: Calendar[];
	onCalendarVisibility?: ((id: string, hidden: boolean) => void) | undefined;
	theme?: ThemeChoice | undefined;
	onTheme?: ((t: ThemeChoice) => void) | undefined;
	onAddAccount?: (() => void) | undefined;
}

const UNIT: Record<ViewState["kind"], string> = {
	day: "day",
	days: "days",
	week: "week",
	month: "month",
};

/** The command menu's groups, limited to what Schedee can do right now. */
export function buildCommands(c: CommandContext): CommandGroup[] {
	const unit = UNIT[c.view.kind];
	const groups: CommandGroup[] = [];

	if (c.createEvent)
		groups.push({
			label: "Calendar",
			items: [
				{
					id: "create",
					label: "Create event…",
					keys: ["C"],
					run: c.createEvent,
				},
			],
		});

	groups.push({
		label: "Navigation",
		items: [
			{
				id: "goto-date",
				label: "Go to date…",
				keys: ["."],
				prompt: {
					placeholder: "Type a date, like Nov 14 or 11/14...",
					submit: (text) => {
						const d = parseDate(text, c.today);
						if (!d) return false;
						c.setView((v) => goTo(v, d));
						return true;
					},
				},
			},
			{
				id: "today",
				label: "Go to today",
				keys: ["T"],
				run: () => c.setView((v) => goTo(v, c.today)),
			},
			{
				id: "next",
				label: `Go to next ${unit}`,
				keys: ["J"],
				run: () => c.setView((v) => step(v, 1)),
			},
			{
				id: "prev",
				label: `Go to previous ${unit}`,
				keys: ["K"],
				run: () => c.setView((v) => step(v, -1)),
			},
			...(c.search
				? [
						{
							id: "search",
							label: "Search events",
							keys: ["/"],
							orKeys: ["⌘", "F"],
							run: c.search,
						},
					]
				: []),
		],
	});

	if (c.onTheme) {
		const pick = c.onTheme;
		const choice = (t: ThemeChoice, label: string): CommandItem => ({
			id: `theme-${t}`,
			label: c.theme === t ? `${label} (current)` : label,
			run: () => pick(t),
		});
		groups.push({
			label: "App",
			items: [
				{
					id: "theme",
					label: "Set theme…",
					items: [
						choice("system", "Use system setting"),
						choice("light", "Light"),
						choice("dark", "Dark"),
					],
				},
			],
		});
	}

	if (c.onCalendarVisibility) {
		const toggle = c.onCalendarVisibility;
		groups.push({
			label: "Calendars",
			items: c.calendars.map((cal) => ({
				id: `cal-${cal.id}`,
				label: `${cal.hidden ? "Show" : "Hide"} “${cal.name}” calendar`,
				run: () => toggle(cal.id, !cal.hidden),
			})),
		});
	}

	if (c.onAddAccount)
		groups.push({
			label: "Accounts",
			items: [
				{
					id: "add-google",
					label: "Add Google Calendar account",
					run: c.onAddAccount,
				},
			],
		});

	const views: CommandItem[] = [];
	if (c.view.kind !== "day")
		views.push({
			id: "view-day",
			label: "Display day view",
			keys: ["1"],
			orKeys: ["D"],
			run: () => c.setView((v) => setView(v, "day")),
		});
	if (c.view.kind !== "week")
		views.push({
			id: "view-week",
			label: "Display week view",
			keys: ["0"],
			orKeys: ["W"],
			run: () => c.setView((v) => setView(v, "week")),
		});
	if (c.view.kind !== "month")
		views.push({
			id: "view-month",
			label: "Display month view",
			keys: ["M"],
			run: () => c.setView((v) => setView(v, "month")),
		});
	views.push({
		id: "view-days",
		label: "Set number of displayed days…",
		items: [2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
			id: `days-${n}`,
			label: `${n} days`,
			keys: [String(n)],
			run: () => c.setView((v) => setView(v, "days", n)),
		})),
	});
	groups.push({ label: "View", items: views });

	return groups;
}
