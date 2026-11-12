/**
 * ICS feed subscriptions. Each feed is one read-only calendar in the "Subscriptions" group;
 * every fetch replaces its events. The web build fetches through the Worker (feeds send no CORS
 * headers); the desktop app fetches from Rust.
 */
import { feedUrl, parseIcs } from "@schedee/core";
import type { Feed, LocalStore } from "../store/db";
import { AUTH_URL, dropDemo } from "./accounts";
import { fetchWithTimeout } from "./google/auth";
import {
	desktopFetchFeed,
	type FeedResponse,
	isDesktop,
} from "./google/desktop";

/** Refresh no more often than this, whatever the feed asks for. */
const FLOOR_MINUTES = 15;
/** When the feed doesn't say. */
const DEFAULT_MINUTES = 60;
const DEFAULT_COLOR = "#039BE5";

export class FeedError extends Error {
	constructor(readonly code: string) {
		super(`Feed failed: ${code}`);
	}
}

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const randomHex = (bytes: number) =>
	Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");

/** A name to show until the feed names itself: the file name, or the host. */
const nameFromUrl = (url: string) => {
	const u = new URL(url);
	const file = decodeURIComponent(u.pathname.split("/").pop() ?? "")
		.replace(/\.ics$/i, "")
		.trim();
	return file && file.length <= 40 && !/^[0-9a-f-]{16,}$/i.test(file)
		? file
		: u.hostname;
};

async function fetchFeed(feed: Feed): Promise<FeedResponse> {
	if (isDesktop())
		return desktopFetchFeed(feed.url, feed.etag, feed.lastModified);
	const res = await fetchWithTimeout(`${AUTH_URL}/feed`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			url: feed.url,
			...(feed.etag ? { etag: feed.etag } : {}),
			...(feed.lastModified ? { lastModified: feed.lastModified } : {}),
		}),
	});
	const r = (await res.json()) as FeedResponse & { error?: string };
	if (r.error) throw new FeedError(r.error);
	return r;
}

const isDue = (f: Feed, now: number) =>
	!f.fetchedAt ||
	now - f.fetchedAt >=
		Math.max(FLOOR_MINUTES, f.refreshMinutes ?? DEFAULT_MINUTES) * 60_000;

/** Fetches one feed and stores what came back. A lost connection leaves it as it was. */
export async function refreshFeed(
	store: LocalStore,
	feed: Feed,
): Promise<void> {
	const fetchedAt = Date.now();
	let res: FeedResponse;
	try {
		res = await fetchFeed(feed);
	} catch (e) {
		if (e instanceof TypeError) return; // offline: try again later
		console.warn(`Feed failed: ${e instanceof FeedError ? e.code : String(e)}`);
		await store.applyFeed(feed.calendarId, {
			feed: { fetchedAt },
			problem: "sync_failed",
		});
		return;
	}
	if (res.status === 304 || res.body === undefined) {
		await store.applyFeed(feed.calendarId, { feed: { fetchedAt } });
		return;
	}
	try {
		const parsed = parseIcs(res.body, feed.calendarId, zone());
		await store.applyFeed(feed.calendarId, {
			feed: {
				fetchedAt,
				...(res.etag ? { etag: res.etag } : {}),
				...(res.lastModified ? { lastModified: res.lastModified } : {}),
				...(parsed.refreshMinutes
					? { refreshMinutes: parsed.refreshMinutes }
					: {}),
			},
			calendar: {
				...(parsed.name ? { name: parsed.name } : {}),
				...(parsed.color ? { color: parsed.color } : {}),
			},
			events: parsed.events,
		});
	} catch (e) {
		console.warn("Feed couldn't be read:", e);
		await store.applyFeed(feed.calendarId, {
			feed: { fetchedAt },
			problem: "sync_failed",
		});
	}
}

/** Refreshes every feed that's due (or all of them with `force`). */
export async function refreshFeeds(
	store: LocalStore,
	force = false,
): Promise<void> {
	const now = Date.now();
	const due = (await store.feeds()).filter((f) => force || isDue(f, now));
	await Promise.all(due.map((f) => refreshFeed(store, f)));
}

/** Adds a feed and loads it. Rejects input that isn't a web link. */
export async function subscribeFeed(
	store: LocalStore,
	input: string,
): Promise<string> {
	const url = feedUrl(input);
	if (!url) throw new FeedError("bad_url");
	const calendarId = `ics:${randomHex(8)}`;
	await dropDemo(store);
	await store.addFeed(
		{
			id: calendarId,
			name: nameFromUrl(url),
			color: DEFAULT_COLOR,
			subscribed: true,
		},
		url,
	);
	const feed = (await store.feeds()).find((f) => f.calendarId === calendarId);
	if (feed) await refreshFeed(store, feed);
	return calendarId;
}

/** Removes a feed and its events. With nothing left, the demo calendars come back. */
export async function unsubscribeFeed(
	store: LocalStore,
	calendarId: string,
): Promise<void> {
	await store.removeFeed(calendarId);
	if ((await store.db.accounts.count()) === 0) await store.reseed();
}
