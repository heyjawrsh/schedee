import {
	type Calendar,
	feedUrl,
	goTo,
	parseDate,
	setView,
	step,
	type Temporal,
	type ViewState,
} from "@schedee/core";
import type { CommandGroup, CommandItem } from "./CommandMenu";

export type ThemeChoice = "light" | "dark" | "system";

/** A CalDAV sign-in. No server means iCloud. */
export interface CalDavLogin {
	server?: string;
	username: string;
	password: string;
}

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
	/** Accounts whose sign-in expired, for "Sign in again". */
	signedOut?:
		| { id: string; label: string; provider?: string | undefined }[]
		| undefined;
	onReconnect?: ((accountId: string) => void) | undefined;
	/** Adds an iCloud or other CalDAV account; resolves false when the login is turned down. */
	onAddCalDav?: ((login: CalDavLogin) => Promise<boolean>) | undefined;
	/** Signs a CalDAV account in again with a new password. */
	onReconnectCalDav?:
		| ((accountId: string, password: string) => Promise<boolean>)
		| undefined;
	/** Synced accounts the user can remove from this device. */
	removable?: { id: string; label: string }[] | undefined;
	onRemoveAccount?: ((accountId: string) => void) | undefined;
	/** Subscribes to an ICS feed at this URL (already checked and normalized). */
	onSubscribeFeed?: ((url: string) => void) | undefined;
	/** Feed subscriptions the user can remove. */
	feeds?: { id: string; name: string }[] | undefined;
	onUnsubscribeFeed?: ((calendarId: string) => void) | undefined;
}

/** A masked prompt that waits on `send` and asks again if it's turned down. */
const password = (
	placeholder: string,
	send: (password: string) => Promise<boolean>,
): NonNullable<CommandItem["prompt"]> => ({
	placeholder,
	secret: true,
	submit: (text) => (text.trim() ? send(text.trim()) : false),
});

const httpsUrl = (text: string) => {
	try {
		const u = new URL(text.trim());
		return u.protocol === "https:" ? u.toString() : null;
	} catch {
		return null;
	}
};

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

	const accounts: CommandItem[] = [];
	for (const a of c.signedOut ?? []) {
		const id = `reconnect-${a.id}`;
		const label = `Sign in again: ${a.label}`;
		if (a.provider === "caldav") {
			const reconnect = c.onReconnectCalDav;
			if (reconnect)
				accounts.push({
					id,
					label,
					prompt: password(`Password for ${a.label}...`, (pw) =>
						reconnect(a.id, pw),
					),
				});
		} else if (c.onReconnect) {
			const reconnect = c.onReconnect;
			accounts.push({ id, label, run: () => reconnect(a.id) });
		}
	}
	if (c.onAddAccount)
		accounts.push({
			id: "add-google",
			label: "Add Google Calendar account",
			run: c.onAddAccount,
		});
	if (c.onAddCalDav) {
		const add = c.onAddCalDav;
		accounts.push({
			id: "add-icloud",
			label: "Add iCloud account…",
			prompt: {
				placeholder: "Your Apple ID email...",
				submit: (text) => {
					const username = text.trim();
					if (!username.includes("@")) return false;
					return {
						id: "add-icloud-password",
						label: "App-specific password",
						prompt: password(
							"App-specific password (from account.apple.com)...",
							(pw) => add({ username, password: pw }),
						),
					};
				},
			},
		});
		accounts.push({
			id: "add-caldav",
			label: "Add CalDAV account…",
			prompt: {
				placeholder: "Server address (https://)...",
				submit: (text) => {
					const server = httpsUrl(text);
					if (!server) return false;
					return {
						id: "add-caldav-user",
						label: "Username",
						prompt: {
							placeholder: "Username...",
							submit: (name) => {
								const username = name.trim();
								if (!username) return false;
								return {
									id: "add-caldav-password",
									label: "Password",
									prompt: password("Password...", (pw) =>
										add({ server, username, password: pw }),
									),
								};
							},
						},
					};
				},
			},
		});
	}
	if (c.onRemoveAccount) {
		const remove = c.onRemoveAccount;
		for (const a of c.removable ?? [])
			accounts.push({
				id: `remove-${a.id}`,
				label: `Remove account: ${a.label}…`,
				// Cancel first, so a stray Enter doesn't remove anything.
				items: [
					{ id: `remove-${a.id}-no`, label: "Cancel", run: () => {} },
					{
						id: `remove-${a.id}-yes`,
						label: "Remove from this device",
						run: () => remove(a.id),
					},
				],
			});
	}
	if (c.onSubscribeFeed) {
		const subscribe = c.onSubscribeFeed;
		accounts.push({
			id: "subscribe-feed",
			label: "Subscribe to calendar feed…",
			prompt: {
				placeholder: "Paste a calendar link (webcal:// or https://)...",
				submit: (text) => {
					const url = feedUrl(text);
					if (!url) return false;
					subscribe(url);
					return true;
				},
			},
		});
	}
	if (c.onUnsubscribeFeed) {
		const unsubscribe = c.onUnsubscribeFeed;
		for (const f of c.feeds ?? [])
			accounts.push({
				id: `unsubscribe-${f.id}`,
				label: `Unsubscribe from “${f.name}”…`,
				// Cancel first, so a stray Enter doesn't remove anything.
				items: [
					{ id: `unsubscribe-${f.id}-no`, label: "Cancel", run: () => {} },
					{
						id: `unsubscribe-${f.id}-yes`,
						label: "Unsubscribe",
						run: () => unsubscribe(f.id),
					},
				],
			});
	}
	if (accounts.length) groups.push({ label: "Accounts", items: accounts });

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
