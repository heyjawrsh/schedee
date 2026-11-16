/**
 * CalDAV sync: find the account's calendars, then pull each one's changes since last time with
 * sync-collection (RFC 6578), or a full listing on servers without it. A calendar whose change
 * tag hasn't moved is skipped. Each resource's server copy is kept for writing back.
 */
import {
	type Account,
	type Calendar,
	type CalendarEvent,
	parseIcs,
} from "@schedee/core";
import type { DavObject, LocalStore } from "../../store/db";
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

/**
 * The last path segment, which names a calendar or an event resource within its parent, without
 * ".ics": a new event's key plus ".ics" is the name it's written under, so sync finds it again.
 */
export const keyOf = (href: string) =>
	decodeURIComponent(
		new URL(href).pathname.split("/").filter(Boolean).pop() ?? "",
	).replace(/\.ics$/i, "");

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

export interface Discovery {
	/** Where the account's calendars live. */
	home: string;
	/** The user's own email addresses (iCloud: the Apple ID and its aliases), lowercase. */
	addresses: string[];
}

/**
 * Finds where an account's calendars live and which addresses are the user's. Tries the server
 * address, then the well-known CalDAV address on that host. Throws DavError(401) for a wrong
 * login.
 */
export async function discover(
	dav: DavRequest,
	server: string,
): Promise<Discovery> {
	const principal =
		(await principalAt(dav, server)) ??
		(await principalAt(dav, new URL("/.well-known/caldav", server).toString()));
	if (!principal) throw new DavError(404);
	const { items } = await multistatus(
		dav,
		"PROPFIND",
		principal,
		"0",
		propfindBody("<c:calendar-home-set/><c:calendar-user-address-set/>"),
	);
	const item = items[0];
	const home =
		item && hrefIn(prop(item, NS.cal, "calendar-home-set"), principal);
	if (!home) throw new DavError(404);
	const set = item && prop(item, NS.cal, "calendar-user-address-set");
	const addresses = set
		? Array.from(set.getElementsByTagNameNS(NS.dav, "href"))
				.map((h) => h.textContent?.trim() ?? "")
				.filter((h) => /^mailto:/i.test(h))
				.map((h) => h.slice("mailto:".length).toLowerCase())
		: [];
	return { home, addresses };
}

export interface RemoteCalendar {
	href: string;
	name: string;
	color: string;
	ctag?: string;
	syncToken?: string;
	/** False when the server says we can only read it. */
	writable: boolean;
}

const WRITE = new Set(["all", "write", "write-content"]);

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
			"<d:resourcetype/><d:displayname/><x:calendar-color/><c:supported-calendar-component-set/><cs:getctag/><d:sync-token/><d:current-user-privilege-set/>",
		),
	);
	return items.filter(isEventCalendar).map((item) => {
		const color = text(prop(item, NS.apple, "calendar-color"));
		const ctag = text(prop(item, NS.cs, "getctag"));
		const syncToken = text(prop(item, NS.dav, "sync-token"));
		const privileges = prop(item, NS.dav, "current-user-privilege-set");
		// No privilege set means the server doesn't say; assume we can write.
		const writable =
			!privileges ||
			Array.from(privileges.getElementsByTagNameNS(NS.dav, "*")).some((p) =>
				WRITE.has(p.localName),
			);
		return {
			writable,
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

export const mapCalendar = (
	accountId: string,
	c: RemoteCalendar,
): Calendar => ({
	id: calendarIdFor(accountId, c.href),
	name: c.name,
	color: c.color,
	...(c.writable ? {} : { readOnly: true }),
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
	const out: { href: string; data: string; etag?: string }[] = [];
	for (let i = 0; i < hrefs.length; i += BATCH) {
		const { items } = await multistatus(
			dav,
			"REPORT",
			calendar,
			"1",
			multigetBody(hrefs.slice(i, i + BATCH)),
		);
		for (const item of items) {
			const data = prop(item, NS.cal, "calendar-data")?.textContent;
			const etag = text(prop(item, NS.dav, "getetag"));
			if (data?.trim())
				out.push({ href: item.href, data, ...(etag ? { etag } : {}) });
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
	/** The signed-in user's addresses, to mark them among guests. */
	self: string[] = [],
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
	const objects: DavObject[] = [];
	const me = new Set(self.map((a) => a.toLowerCase()));
	for (const o of await fetchObjects(dav, remote.href, changes.changed)) {
		const key = keyOf(o.href);
		try {
			for (const e of parseIcs(o.data, calendarId, zone, key).events)
				put.push(
					e.attendees
						? {
								...e,
								attendees: e.attendees.map((a) =>
									me.has(a.email) ? { ...a, self: true } : a,
								),
							}
						: e,
				);
			objects.push({
				id: `${calendarId}#${key}`,
				calendarId,
				href: o.href,
				ics: o.data,
				...(o.etag ? { etag: o.etag } : {}),
			});
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
			href: remote.href,
			syncedAt: Date.now(),
		},
		{ put, remove, objects },
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
	const server = cred.server ?? new URL("/", home).toString();
	let addresses = cred.addresses;
	if (!addresses) {
		// Signed in before we kept the user's addresses: look them up, and read every event again
		// so the user is found among its guests.
		({ home, addresses } = await discover(dav, server));
		await store.updateCredential({ ...cred, home, addresses });
		await store.db.syncState.where("accountId").equals(account.id).delete();
	}
	let remote: RemoteCalendar[];
	try {
		remote = await listCalendars(dav, home);
	} catch (e) {
		// The home moved: look it up again once.
		if (!(e instanceof DavError) || e.status !== 404) throw e;
		({ home, addresses } = await discover(dav, server));
		await store.updateCredential({ ...cred, home, addresses });
		remote = await listCalendars(dav, home);
	}
	const self = [...new Set([...addresses, account.label.toLowerCase()])];
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
		changed += await syncCalendar(store, dav, account.id, c, zone, self);
	return { calendars: remote.length, changed };
}
