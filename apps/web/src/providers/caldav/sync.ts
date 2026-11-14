/**
 * CalDAV sync: find the account's calendars, then pull each one's changes since last time with
 * sync-collection (RFC 6578), or a full listing on servers without it. A calendar whose change
 * tag hasn't moved is skipped. Read-only for now.
 */
import {
	type Account,
	type Calendar,
	type CalendarEvent,
	parseIcs,
} from "@schedee/core";
import type { LocalStore } from "../../store/db";
import {
	DavError,
	type DavItem,
	type DavRequest,
	eventQueryBody,
	hrefIn,
	multigetBody,
	multistatus,
	NS,
	prop,
	propfindBody,
	syncCollectionBody,
} from "./dav";

export const ICLOUD_SERVER = "https://caldav.icloud.com/";
const DEFAULT_COLOR = "#1BADF8";
/** Resources per multiget. */
const BATCH = 50;

/** The last path segment, which names a calendar or an event resource within its parent. */
export const keyOf = (href: string) =>
	decodeURIComponent(
		new URL(href).pathname.split("/").filter(Boolean).pop() ?? "",
	);

const text = (el: Element | undefined) => el?.textContent?.trim() || undefined;

async function principalAt(dav: DavRequest, url: string) {
	try {
		const { items } = await multistatus(
			dav,
			"PROPFIND",
			url,
			"0",
			propfindBody("<d:current-user-principal/>"),
		);
		const item = items[0];
		return item && hrefIn(prop(item, NS.dav, "current-user-principal"), url);
	} catch (e) {
		if (e instanceof DavError && e.status !== 401 && e.status !== 403)
			return undefined;
		throw e;
	}
}

/**
 * Finds where an account's calendars live. Tries the server address, then the well-known
 * CalDAV address on that host. Throws DavError(401) for a wrong login.
 */
export async function discover(
	dav: DavRequest,
	server: string,
): Promise<string> {
	const principal =
		(await principalAt(dav, server)) ??
		(await principalAt(dav, new URL("/.well-known/caldav", server).toString()));
	if (!principal) throw new DavError(404);
	const { items } = await multistatus(
		dav,
		"PROPFIND",
		principal,
		"0",
		propfindBody("<c:calendar-home-set/>"),
	);
	const item = items[0];
	const home =
		item && hrefIn(prop(item, NS.cal, "calendar-home-set"), principal);
	if (!home) throw new DavError(404);
	return home;
}

export interface RemoteCalendar {
	href: string;
	name: string;
	color: string;
	ctag?: string;
	syncToken?: string;
}

const isEventCalendar = (item: DavItem) => {
	const type = prop(item, NS.dav, "resourcetype");
	if (
		!type ||
		!Array.from(type.children).some(
			(c) => c.namespaceURI === NS.cal && c.localName === "calendar",
		)
	)
		return false;
	const comps = prop(item, NS.cal, "supported-calendar-component-set");
	// No set means any component.
	return (
		!comps ||
		Array.from(comps.children).some(
			(c) => c.getAttribute("name")?.toUpperCase() === "VEVENT",
		)
	);
};

/** The calendars in an account's home that hold events. */
export async function listCalendars(
	dav: DavRequest,
	home: string,
): Promise<RemoteCalendar[]> {
	const { items } = await multistatus(
		dav,
		"PROPFIND",
		home,
		"1",
		propfindBody(
			"<d:resourcetype/><d:displayname/><x:calendar-color/><c:supported-calendar-component-set/><cs:getctag/><d:sync-token/>",
		),
	);
	return items.filter(isEventCalendar).map((item) => {
		const color = text(prop(item, NS.apple, "calendar-color"));
		const ctag = text(prop(item, NS.cs, "getctag"));
		const syncToken = text(prop(item, NS.dav, "sync-token"));
		return {
			href: item.href,
			name: text(prop(item, NS.dav, "displayname")) ?? keyOf(item.href),
			color:
				color && /^#[0-9a-f]{6}/i.test(color)
					? color.slice(0, 7).toUpperCase()
					: DEFAULT_COLOR,
			...(ctag ? { ctag } : {}),
			...(syncToken ? { syncToken } : {}),
		};
	});
}

export const calendarIdFor = (accountId: string, href: string) =>
	`${accountId}/${keyOf(href)}`;

/** Read-only until writes back to the server are in. */
export const mapCalendar = (
	accountId: string,
	c: RemoteCalendar,
): Calendar => ({
	id: calendarIdFor(accountId, c.href),
	name: c.name,
	color: c.color,
	readOnly: true,
});

interface Changes {
	changed: string[];
	removed: string[];
	syncToken?: string;
}

async function changesSince(
	dav: DavRequest,
	calendar: string,
	token: string,
): Promise<Changes> {
	const { items, syncToken } = await multistatus(
		dav,
		"REPORT",
		calendar,
		undefined,
		syncCollectionBody(token),
	);
	const members = items.filter((i) => i.href !== calendar);
	return {
		changed: members
			.filter((i) => !i.status || i.status === 200)
			.map((i) => i.href),
		removed: members.filter((i) => i.status === 404).map((i) => i.href),
		...(syncToken ? { syncToken } : {}),
	};
}

async function everything(dav: DavRequest, calendar: string): Promise<Changes> {
	const { items } = await multistatus(
		dav,
		"REPORT",
		calendar,
		"1",
		eventQueryBody(),
	);
	return {
		changed: items.filter((i) => i.href !== calendar).map((i) => i.href),
		removed: [],
	};
}

async function fetchObjects(
	dav: DavRequest,
	calendar: string,
	hrefs: string[],
) {
	const out: { href: string; data: string }[] = [];
	for (let i = 0; i < hrefs.length; i += BATCH) {
		const { items } = await multistatus(
			dav,
			"REPORT",
			calendar,
			"1",
			multigetBody(hrefs.slice(i, i + BATCH)),
		);
		for (const item of items) {
			const data = text(prop(item, NS.cal, "calendar-data"));
			if (data) out.push({ href: item.href, data });
		}
	}
	return out;
}

/** Offline or signed out: retrying with a full listing won't help. (403 is how a server says a sync token is no good.) */
const fatal = (e: unknown) =>
	e instanceof TypeError || (e instanceof DavError && e.status === 401);

/** Pulls one calendar's changes into the store. Returns how many resources changed. */
export async function syncCalendar(
	store: LocalStore,
	dav: DavRequest,
	accountId: string,
	remote: RemoteCalendar,
	zone: string,
): Promise<number> {
	const calendarId = calendarIdFor(accountId, remote.href);
	const prior = await store.getSyncState(calendarId);
	if (prior?.ctag && prior.ctag === remote.ctag) return 0;

	let reset = !prior?.syncToken;
	let changes: Changes;
	try {
		changes = await changesSince(dav, remote.href, prior?.syncToken ?? "");
	} catch (e) {
		// The server forgot our place or doesn't do sync-collection: list everything instead.
		if (fatal(e)) throw e;
		reset = true;
		changes = await everything(dav, remote.href);
	}

	const put: CalendarEvent[] = [];
	for (const o of await fetchObjects(dav, remote.href, changes.changed)) {
		try {
			put.push(...parseIcs(o.data, calendarId, zone, keyOf(o.href)).events);
		} catch {
			// Skip a resource we can't read; keep the rest.
		}
	}
	// A changed resource replaces its old series and overrides.
	const remove = [...changes.changed, ...changes.removed].map(
		(h) => `${calendarId}#${keyOf(h)}`,
	);
	await store.applySync(
		{
			calendarId,
			accountId,
			...(changes.syncToken ? { syncToken: changes.syncToken } : {}),
			...(remote.ctag ? { ctag: remote.ctag } : {}),
			syncedAt: Date.now(),
		},
		{ put, remove },
		reset,
	);
	return changes.changed.length + changes.removed.length;
}

/** Refreshes the calendar list, then each calendar's events. */
export async function syncCalDavAccount(
	store: LocalStore,
	account: Pick<Account, "id" | "label">,
	dav: DavRequest,
	zone: string,
): Promise<{ calendars: number; changed: number }> {
	const cred = await store.getCredential(account.id);
	if (!cred) return { calendars: 0, changed: 0 };
	let home = cred.home;
	if (!home) throw new DavError(401);
	let remote: RemoteCalendar[];
	try {
		remote = await listCalendars(dav, home);
	} catch (e) {
		// The home moved: look it up again once.
		if (!(e instanceof DavError) || e.status !== 404) throw e;
		const server = new URL("/", home).toString();
		home = await discover(dav, server);
		await store.updateCredential({ ...cred, home });
		remote = await listCalendars(dav, home);
	}
	// The account may have been removed while the list was loading; don't bring it back.
	const kept = await store.upsertAccount(
		{
			id: account.id,
			label: account.label,
			provider: "caldav",
			calendars: remote.map((c) => mapCalendar(account.id, c)),
		},
		{ create: false },
	);
	if (!kept) return { calendars: 0, changed: 0 };
	let changed = 0;
	for (const c of remote)
		changed += await syncCalendar(store, dav, account.id, c, zone);
	return { calendars: remote.length, changed };
}
