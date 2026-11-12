import {
	type Account,
	type CalendarEvent,
	type GoogleCalendarListEntry,
	type GoogleEvent,
	mapGoogleCalendar,
	mapGoogleEvent,
} from "@schedee/core";
import type { LocalStore } from "../../store/db";
import {
	fetchWithTimeout,
	GoogleAuthError,
	type GoogleTokens,
	refreshGoogle,
} from "./auth";
import { desktopRefresh } from "./desktop";

const API = "https://www.googleapis.com/calendar/v3";
/** Refresh a little before the access token runs out. */
const EARLY_MS = 60_000;

export class GoogleApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** A fetch for one account that adds the access token and refreshes it when needed. */
export function googleFetcher(
	store: LocalStore,
	accountId: string,
	authUrl: string,
) {
	const token = async (force = false) => {
		const cred = await store.getCredential(accountId);
		if (!cred) throw new GoogleApiError(401, "not signed in");
		if (
			!force &&
			cred.accessToken &&
			(cred.expiresAt ?? 0) - EARLY_MS > Date.now()
		)
			return cred.accessToken;
		let fresh: GoogleTokens;
		if (cred.keychain) fresh = await desktopRefresh(accountId);
		else if (cred.refreshToken)
			fresh = await refreshGoogle(authUrl, cred.refreshToken);
		else throw new GoogleAuthError("not_signed_in");
		const refreshToken = fresh.refreshToken ?? cred.refreshToken;
		// Only refreshes a credential that's still here: the account may have been removed meanwhile.
		await store.updateCredential({
			...cred,
			accessToken: fresh.accessToken,
			expiresAt: fresh.expiresAt,
			// Google may rotate the refresh token.
			...(refreshToken ? { refreshToken } : {}),
		});
		return fresh.accessToken;
	};
	return async <T>(
		path: string,
		params: Record<string, string> = {},
		init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
	): Promise<T> => {
		const query = new URLSearchParams(params).toString();
		const url = `${API}${path}${query ? `?${query}` : ""}`;
		const go = async (force: boolean) =>
			fetchWithTimeout(url, {
				method: init.method ?? "GET",
				headers: {
					Authorization: `Bearer ${await token(force)}`,
					...(init.body === undefined
						? {}
						: { "Content-Type": "application/json" }),
				},
				...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
			});
		let res = await go(false);
		if (res.status === 401) res = await go(true);
		if (!res.ok) throw new GoogleApiError(res.status, await res.text());
		// Deletes answer 204 with no body.
		const text = await res.text();
		return (text ? JSON.parse(text) : undefined) as T;
	};
}

export type Fetcher = ReturnType<typeof googleFetcher>;

interface Page<T> {
	items?: T[];
	nextPageToken?: string;
	nextSyncToken?: string;
	timeZone?: string;
}

async function listAll<T>(
	get: Fetcher,
	path: string,
	params: Record<string, string>,
) {
	const items: T[] = [];
	let page: Page<T> = {};
	do {
		page = await get<Page<T>>(path, {
			...params,
			...(page.nextPageToken ? { pageToken: page.nextPageToken } : {}),
		});
		items.push(...(page.items ?? []));
	} while (page.nextPageToken);
	return { items, nextSyncToken: page.nextSyncToken, timeZone: page.timeZone };
}

/** Refreshes the account's calendar list, then pulls every calendar's changes since last time. */
export async function syncGoogleAccount(
	store: LocalStore,
	account: Pick<Account, "id" | "label">,
	authUrl: string,
): Promise<{ calendars: number; changed: number }> {
	const get = googleFetcher(store, account.id, authUrl);
	const { items: entries } = await listAll<GoogleCalendarListEntry>(
		get,
		"/users/me/calendarList",
		{ maxResults: "250" },
	);
	const live = entries.filter((c) => !c.deleted);
	// The account may have been removed while the list was loading; don't bring it back.
	const kept = await store.upsertAccount(
		{
			id: account.id,
			label: account.label,
			provider: "google",
			calendars: live.map((c) => mapGoogleCalendar(c, account.id)),
		},
		{ create: false },
	);
	if (!kept) return { calendars: 0, changed: 0 };

	let changed = 0;
	for (const entry of live) {
		const calendarId = mapGoogleCalendar(entry, account.id).id;
		changed += await syncCalendar(store, get, account.id, calendarId, entry);
	}
	return { calendars: live.length, changed };
}

async function syncCalendar(
	store: LocalStore,
	get: Fetcher,
	accountId: string,
	calendarId: string,
	entry: GoogleCalendarListEntry,
): Promise<number> {
	const path = `/calendars/${encodeURIComponent(entry.id)}/events`;
	const prior = await store.getSyncState(calendarId);
	const pull = (syncToken?: string) =>
		listAll<GoogleEvent>(get, path, {
			maxResults: "2500",
			showDeleted: "true",
			...(syncToken ? { syncToken } : {}),
		});

	let reset = !prior?.syncToken;
	let result: Awaited<ReturnType<typeof pull>>;
	try {
		result = await pull(prior?.syncToken);
	} catch (e) {
		// The server forgot our place: start this calendar over.
		if (!(e instanceof GoogleApiError) || e.status !== 410) throw e;
		reset = true;
		result = await pull();
	}

	const zone = result.timeZone ?? entry.timeZone ?? "UTC";
	const put: CalendarEvent[] = [];
	const remove: string[] = [];
	for (const g of result.items) {
		const e = mapGoogleEvent(g, calendarId, zone);
		if (e) put.push(e);
		else remove.push(`${calendarId}#${g.id}`);
	}
	await store.applySync(
		{
			calendarId,
			accountId,
			...(result.nextSyncToken ? { syncToken: result.nextSyncToken } : {}),
			syncedAt: Date.now(),
		},
		{ put, remove },
		reset,
	);
	return put.length + remove.length;
}
