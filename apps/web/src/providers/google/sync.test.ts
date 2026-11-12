import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalStore, SchedeeDB } from "../../store/db";
import { fetchWithTimeout } from "./auth";
import { googleFetcher, syncGoogleAccount } from "./sync";

const desktop = vi.hoisted(() => ({ desktopRefresh: vi.fn() }));
vi.mock("./desktop", () => desktop);

let n = 0;
const store = () =>
	createLocalStore(
		() => ({ accounts: [], events: [] }),
		new SchedeeDB(`sync-${++n}`),
	);
const ok = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
	vi.unstubAllGlobals();
	desktop.desktopRefresh.mockReset();
});

describe("googleFetcher", () => {
	it("asks the keychain for a new token on desktop and stores no refresh token", async () => {
		const s = store();
		await s.putCredential({
			accountId: "google:ada@example.com",
			keychain: true,
			accessToken: "old",
			expiresAt: 0,
		});
		desktop.desktopRefresh.mockResolvedValue({
			accessToken: "new",
			expiresAt: Date.now() + 3_600_000,
		});
		const fetch = vi.fn(async () => ok({ items: [] }));
		vi.stubGlobal("fetch", fetch);

		await googleFetcher(s, "google:ada@example.com", "http://auth")("/x");

		expect(desktop.desktopRefresh).toHaveBeenCalledWith(
			"google:ada@example.com",
		);
		expect(fetch).toHaveBeenCalledOnce();
		const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
			.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer new");
		const cred = await s.getCredential("google:ada@example.com");
		expect(cred).toMatchObject({ keychain: true, accessToken: "new" });
		expect(cred?.refreshToken).toBeUndefined();
	});
});

describe("syncGoogleAccount", () => {
	const ada = { id: "google:ada@example.com", label: "ada@example.com" };
	const list = {
		items: [{ id: "ada@example.com", summary: "Ada", accessRole: "owner" }],
	};
	const events = {
		items: [
			{
				id: "e1",
				status: "confirmed",
				summary: "Kickoff",
				start: { dateTime: "2026-11-12T10:00:00Z" },
				end: { dateTime: "2026-11-12T11:00:00Z" },
			},
		],
		nextSyncToken: "t",
	};
	const signedIn = async () => {
		const s = store();
		await s.upsertAccount({ ...ada, provider: "google", calendars: [] });
		await s.putCredential({
			accountId: ada.id,
			refreshToken: "r",
			accessToken: "a",
			expiresAt: Date.now() + 3_600_000,
		});
		return s;
	};
	/** Fetch that answers the calendar list and events, holding one of them until released. */
	const slowAt = (hold: "calendarList" | "events") => {
		let release = () => {};
		const held = new Promise<void>((r) => {
			release = r;
		});
		let reached = () => {};
		const waiting = new Promise<void>((r) => {
			reached = r;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				const isList = url.includes("/calendarList");
				if ((hold === "calendarList") === isList) {
					reached();
					await held;
				}
				return ok(isList ? list : events);
			}),
		);
		return { waiting, release };
	};

	it("doesn't bring back an account removed while its calendar list loads", async () => {
		const s = await signedIn();
		const slow = slowAt("calendarList");
		const sync = syncGoogleAccount(s, ada, "http://auth");
		await slow.waiting;
		await s.removeAccount(ada.id);
		slow.release();
		await sync;
		expect(await s.db.accounts.count()).toBe(0);
		expect(await s.db.events.count()).toBe(0);
		expect(await s.db.syncState.count()).toBe(0);
	});

	it("drops events that arrive after their account was removed", async () => {
		const s = await signedIn();
		const slow = slowAt("events");
		const sync = syncGoogleAccount(s, ada, "http://auth");
		await slow.waiting;
		await s.removeAccount(ada.id);
		slow.release();
		await sync;
		expect(await s.db.accounts.count()).toBe(0);
		expect(await s.db.events.count()).toBe(0);
		expect(await s.db.syncState.count()).toBe(0);
	});

	it("doesn't store a refreshed token for a removed account", async () => {
		const s = store();
		await s.updateCredential({ accountId: ada.id, accessToken: "late" });
		expect(await s.getCredential(ada.id)).toBeUndefined();
	});
});

describe("fetchWithTimeout", () => {
	it("treats a request with no answer like a lost connection", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new DOMException("timed out", "TimeoutError");
			}),
		);
		await expect(fetchWithTimeout("http://localhost:8787/x")).rejects.toThrow(
			TypeError,
		);
	});
});
