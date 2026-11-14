import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoSeed } from "../demo";
import { createLocalStore, FEEDS_ACCOUNT, SchedeeDB } from "../store/db";
import { refreshFeeds, subscribeFeed, unsubscribeFeed } from "./feeds";

vi.mock("./google/desktop", () => ({
	isDesktop: () => false,
	desktopFetchFeed: vi.fn(),
	desktopForget: vi.fn(),
	desktopSignIn: vi.fn(),
	desktopRefresh: vi.fn(),
}));

const ics = (title: string) =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"X-WR-CALNAME:Rota",
		"BEGIN:VEVENT",
		"UID:a",
		`SUMMARY:${title}`,
		"DTSTART:20261112T100000Z",
		"DTEND:20261112T110000Z",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

let n = 0;
const store = () => createLocalStore(demoSeed, new SchedeeDB(`feeds-${++n}`));
const answer = (body: unknown) =>
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(body)),
	);
const titles = async (s: ReturnType<typeof store>) =>
	(await s.db.events.toArray()).map((e) => e.title);
const calendar = async (s: ReturnType<typeof store>) =>
	(await s.db.accounts.get(FEEDS_ACCOUNT))?.calendars[0];

afterEach(() => vi.unstubAllGlobals());

describe("feeds", () => {
	it("subscribes, names the calendar from the feed and drops the demo", async () => {
		const s = store();
		await s.ready;
		answer({ status: 200, body: ics("Shift"), etag: '"1"' });
		const id = await subscribeFeed(s, "webcal://example.com/rota.ics");

		expect((await s.db.accounts.toArray()).map((a) => a.id)).toEqual([
			FEEDS_ACCOUNT,
		]);
		expect(await calendar(s)).toMatchObject({
			id,
			name: "Rota",
			subscribed: true,
		});
		expect(await titles(s)).toEqual(["Shift"]);
		const [feed] = await s.feeds();
		expect(feed).toMatchObject({
			url: "https://example.com/rota.ics",
			etag: '"1"',
		});
	});

	it("doesn't add the same link twice", async () => {
		const s = store();
		await s.ready;
		answer({ status: 200, body: ics("Shift") });
		const a = await subscribeFeed(s, "webcal://example.com/rota.ics");
		const b = await subscribeFeed(s, "https://example.com/rota.ics");
		expect(b).toBe(a);
		expect(await s.feeds()).toHaveLength(1);
		expect((await s.db.accounts.get(FEEDS_ACCOUNT))?.calendars).toHaveLength(1);
	});

	it("doesn't add a link twice when it's submitted twice at once", async () => {
		const s = store();
		await s.ready;
		answer({ status: 200, body: ics("Shift") });
		const [a, b] = await Promise.all([
			subscribeFeed(s, "https://example.com/rota.ics"),
			subscribeFeed(s, "https://example.com/rota.ics"),
		]);
		expect(b).toBe(a);
		expect(await s.feeds()).toHaveLength(1);
		expect((await s.db.accounts.get(FEEDS_ACCOUNT))?.calendars).toHaveLength(1);
	});

	it("keeps what it has when the feed fails, and says so until it loads again", async () => {
		const s = store();
		await s.ready;
		answer({ status: 200, body: ics("Shift") });
		await subscribeFeed(s, "https://example.com/rota.ics");

		answer({ error: "unreachable" });
		await refreshFeeds(s, true);
		expect(await titles(s)).toEqual(["Shift"]);
		expect((await calendar(s))?.problem).toBe("sync_failed");

		answer({ status: 200, body: ics("Shift (moved)") });
		await refreshFeeds(s, true);
		expect(await titles(s)).toEqual(["Shift (moved)"]);
		expect((await calendar(s))?.problem).toBeUndefined();
	});

	it("leaves the feed alone offline and on 304, and only refreshes when due", async () => {
		const s = store();
		await s.ready;
		answer({ status: 200, body: ics("Shift") });
		await subscribeFeed(s, "https://example.com/rota.ics");

		vi.stubGlobal("fetch", async () => {
			throw new TypeError("offline");
		});
		await refreshFeeds(s, true);
		expect(await titles(s)).toEqual(["Shift"]);
		expect((await calendar(s))?.problem).toBeUndefined();

		answer({ status: 304 });
		await refreshFeeds(s, true);
		expect(await titles(s)).toEqual(["Shift"]);

		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await refreshFeeds(s);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("doesn't bring back a feed removed while it was loading", async () => {
		const s = store();
		await s.ready;
		answer({ status: 200, body: ics("Shift") });
		const id = await subscribeFeed(s, "https://example.com/rota.ics");
		await s.removeFeed(id);
		await s.applyFeed(id, { feed: { fetchedAt: 1 }, events: [] });
		expect(await s.feeds()).toEqual([]);
		expect(await s.db.accounts.get(FEEDS_ACCOUNT)).toBeUndefined();
	});

	it("unsubscribing the last feed brings the demo back", async () => {
		const s = store();
		await s.ready;
		answer({ status: 200, body: ics("Shift") });
		const id = await subscribeFeed(s, "https://example.com/rota.ics");
		await unsubscribeFeed(s, id);
		expect(await titles(s)).not.toContain("Shift");
		expect(
			(await s.db.accounts.orderBy("order").toArray()).map((a) => a.id),
		).toEqual(demoSeed().accounts.map((a) => a.id));
	});
});
