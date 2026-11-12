import {
	type Account,
	applyResult,
	type Calendar,
	type CalendarEvent,
	type CalendarSnapshot,
	type EditResult,
	type GoogleTarget,
	type GoogleWrite,
	googleCalendarKey,
	planGoogleWrites,
} from "@schedee/core";
import { Dexie, type EntityTable, liveQuery } from "dexie";

/** Local-first storage for calendars and events (IndexedDB in the browser and in the Tauri webview). */
/** Accounts carry their position so the sidebar keeps the order they were added in. */
type StoredAccount = Account & { order: number };

/** OAuth tokens for a synced account. Kept on the device only. */
export interface Credential {
	accountId: string;
	/** Web only. On desktop the refresh token lives in the OS keychain instead. */
	refreshToken?: string;
	/** The refresh token is in the OS keychain (desktop). */
	keychain?: true;
	accessToken?: string;
	/** Epoch ms. */
	expiresAt?: number;
}

/** Where incremental sync left off for one calendar. */
export interface SyncState {
	calendarId: string;
	accountId: string;
	syncToken?: string;
	syncedAt?: number;
}

/** A Google write waiting to be sent, in the order edits were made. */
export type QueuedWrite = GoogleWrite & {
	seq?: number;
	/** Failed sends so far, and why the last one failed. */
	tries?: number;
	error?: string;
};

/** An ICS feed subscription: one calendar in the "Subscriptions" group. */
export interface Feed {
	calendarId: string;
	/** Often carries a secret token; kept on the device only. */
	url: string;
	etag?: string;
	lastModified?: string;
	/** Epoch ms of the last fetch attempt that got an answer. */
	fetchedAt?: number;
	/** What the feed asks for; we refresh no more often than every 15 minutes. */
	refreshMinutes?: number;
}

/** The account that groups feed subscriptions in the sidebar. */
export const FEEDS_ACCOUNT = "ics";

export class SchedeeDB extends Dexie {
	accounts!: EntityTable<StoredAccount, "id">;
	events!: EntityTable<CalendarEvent, "id">;
	credentials!: EntityTable<Credential, "accountId">;
	syncState!: EntityTable<SyncState, "calendarId">;
	outbox!: EntityTable<QueuedWrite, "seq">;
	feeds!: EntityTable<Feed, "calendarId">;

	constructor(name = "schedee") {
		super(name);
		this.version(1).stores({
			accounts: "id, order",
			events: "id, calendarId, recurringEventId, start",
		});
		this.version(2).stores({
			credentials: "accountId",
			syncState: "calendarId, accountId",
		});
		// v3: Google exceptions are stored under override ids, so synced calendars start over.
		this.version(3)
			.stores({ outbox: "++seq, accountId, *localIds" })
			.upgrade((tx) => tx.table("syncState").clear());
		this.version(4).stores({ feeds: "calendarId" });
	}
}

export interface LocalStore {
	db: SchedeeDB;
	/** Resolves once the store holds at least the seed data. */
	ready: Promise<void>;
	subscribe(
		onChange: (s: Pick<CalendarSnapshot, "accounts" | "events">) => void,
	): () => void;
	putEvent(e: CalendarEvent): Promise<void>;
	deleteEvent(id: string): Promise<void>;
	/**
	 * Applies an edit result (puts and removals) atomically, queueing the writes that carry it to
	 * synced calendars. Resolves with how many writes were queued.
	 */
	commit(r: EditResult): Promise<number>;
	/** Resolves once every commit started so far is on disk. */
	settled(): Promise<void>;
	setCalendarHidden(calendarId: string, hidden: boolean): Promise<void>;
	/**
	 * Adds an account or refreshes its calendar list. Calendars the user hid here stay hidden;
	 * calendars that disappeared take their events and sync state with them. With
	 * `create: false` it only refreshes an account that's still here. Resolves with whether the
	 * account was written.
	 */
	upsertAccount(a: Account, opts?: { create?: boolean }): Promise<boolean>;
	/** Flags an account that needs attention, or clears the flag. */
	setAccountProblem(id: string, problem: Account["problem"]): Promise<void>;
	/** The user has seen the "changes weren't saved" notice. */
	dismissDropped(id: string): Promise<void>;
	/** Removes an account with its calendars, events, tokens, sync state and unsent writes. */
	removeAccount(id: string): Promise<void>;
	/** Puts the seed data back if the store is empty. */
	reseed(): Promise<void>;
	/** Every feed subscription. */
	feeds(): Promise<Feed[]>;
	/** Adds a feed's calendar to the "Subscriptions" group, creating the group if needed. */
	addFeed(calendar: Calendar, url: string): Promise<void>;
	/**
	 * Records a fetch: new validators and timing, the calendar's name, color and problem, and,
	 * with `events`, the feed's full contents in place of the old ones. Does nothing if the feed
	 * was removed meanwhile.
	 */
	applyFeed(
		calendarId: string,
		update: {
			feed: Partial<Omit<Feed, "calendarId" | "url">>;
			calendar?: Partial<Pick<Calendar, "name" | "color">>;
			problem?: Calendar["problem"];
			events?: CalendarEvent[];
		},
	): Promise<void>;
	/** Removes a feed with its events; the group goes once it's empty. */
	removeFeed(calendarId: string): Promise<void>;
	getCredential(accountId: string): Promise<Credential | undefined>;
	putCredential(c: Credential): Promise<void>;
	/** Replaces a credential only if it's still stored (a sync can outlive its account). */
	updateCredential(c: Credential): Promise<void>;
	getSyncState(calendarId: string): Promise<SyncState | undefined>;
	/** One account's queued writes, oldest first. */
	pendingWrites(accountId: string): Promise<QueuedWrite[]>;
	/** A write went through. */
	finishWrite(seq: number): Promise<void>;
	/** A write failed but may work later. */
	retryWrite(seq: number, error: string): Promise<void>;
	/**
	 * The provider refused a write for good. It's dropped, and its calendar resyncs from scratch so
	 * this device goes back to what the provider has.
	 */
	dropWrite(seq: number, error: string): Promise<void>;
	/**
	 * Applies one calendar's sync results. With `reset`, the calendar's events are replaced
	 * (a full resync after the server dropped our sync token). Events with writes still queued
	 * keep their local version. Nothing is written if the account is gone.
	 */
	applySync(
		state: SyncState,
		changes: { put: CalendarEvent[]; remove: string[] },
		reset?: boolean,
	): Promise<void>;
}

/** Where each synced calendar lives in Google. */
const googleTargets = (accounts: Account[]) => {
	const map = new Map<string, GoogleTarget>();
	for (const a of accounts)
		if (a.provider === "google")
			for (const c of a.calendars)
				map.set(c.id, {
					accountId: a.id,
					calendarId: c.id.slice(a.id.length + 1),
				});
	return map;
};

export function createLocalStore(
	seed: () => Pick<CalendarSnapshot, "accounts" | "events">,
	db: SchedeeDB = new SchedeeDB(),
	/** Stands in for timed events that carry no zone of their own. */
	zone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): LocalStore {
	const pendingIds = async () =>
		new Set((await db.outbox.toArray()).flatMap((w) => w.localIds));
	const saving = new Set<Promise<number>>();
	/** One commit: the edit plus the writes that carry it to synced calendars, in one transaction. */
	async function save(r: EditResult): Promise<number> {
		return db.transaction(
			"rw",
			[db.events, db.accounts, db.outbox],
			async () => {
				// The touched events, plus the series of any override among them.
				const ids = new Set([...r.remove, ...r.put.map((e) => e.id)]);
				const touched = (await db.events.bulkGet([...ids])).filter(
					(e): e is CalendarEvent => !!e,
				);
				for (const e of [...touched, ...r.put])
					if (e.recurringEventId) ids.add(e.recurringEventId);
				const known = (await db.events.bulkGet([...ids])).filter(
					(e): e is CalendarEvent => !!e,
				);
				const before = new Map(known.map((e) => [e.id, e]));
				const after = new Map(applyResult(known, r).map((e) => [e.id, e]));
				const targets = googleTargets(await db.accounts.toArray());
				const writes = planGoogleWrites(
					r,
					before,
					after,
					(id) => targets.get(id),
					zone,
				);
				if (r.remove.length) await db.events.bulkDelete(r.remove);
				if (r.put.length) await db.events.bulkPut(r.put);
				if (writes.length) await db.outbox.bulkAdd(writes);
				return writes.length;
			},
		);
	}
	const reseed = () =>
		db.transaction("rw", db.accounts, db.events, async () => {
			if ((await db.accounts.count()) > 0) return;
			const s = seed();
			await db.accounts.bulkPut(
				s.accounts.map((a, order) => ({ ...a, order })),
			);
			await db.events.bulkPut(s.events);
		});
	const ready = reseed();
	return {
		db,
		ready,
		reseed,
		subscribe(onChange) {
			const sub = liveQuery(async () => ({
				accounts: (await db.accounts.orderBy("order").toArray()).map(
					({ order: _order, ...a }) => a,
				),
				events: await db.events.toArray(),
			})).subscribe({
				next: onChange,
				error: (e) => console.error("store", e),
			});
			return () => sub.unsubscribe();
		},
		async putEvent(e) {
			await db.events.put(e);
		},
		settled: () => Promise.allSettled([...saving]).then(() => {}),
		commit(r) {
			const p = save(r);
			saving.add(p);
			void p.finally(() => saving.delete(p)).catch(() => {});
			return p;
		},
		pendingWrites: (accountId) =>
			db.outbox.where("accountId").equals(accountId).sortBy("seq"),
		async finishWrite(seq) {
			await db.outbox.delete(seq);
		},
		async retryWrite(seq, error) {
			await db.outbox
				.where("seq")
				.equals(seq)
				.modify((w) => {
					w.tries = (w.tries ?? 0) + 1;
					w.error = error;
				});
		},
		async dropWrite(seq, error) {
			await db.transaction(
				"rw",
				[db.outbox, db.syncState, db.accounts],
				async () => {
					const w = await db.outbox.get(seq);
					if (!w) return;
					console.warn(`Dropped a Google write (${w.kind}): ${error}`);
					await db.outbox.delete(seq);
					const calendarId = googleCalendarKey(w.accountId, w.calendarId);
					const state = await db.syncState.get(calendarId);
					if (state) {
						const { syncToken: _t, ...rest } = state;
						await db.syncState.put(rest);
					}
					await db.accounts
						.where("id")
						.equals(w.accountId)
						.modify((a) => {
							a.dropped = (a.dropped ?? 0) + 1;
						});
				},
			);
		},
		async setAccountProblem(id, problem) {
			await db.accounts
				.where("id")
				.equals(id)
				.modify((a) => {
					if (problem) a.problem = problem;
					else delete a.problem;
				});
		},
		async dismissDropped(id) {
			await db.accounts
				.where("id")
				.equals(id)
				.modify((a) => {
					delete a.dropped;
				});
		},
		async setCalendarHidden(calendarId, hidden) {
			await db.transaction("rw", db.accounts, async () => {
				const all = await db.accounts.toArray();
				const owner = all.find((a) =>
					a.calendars.some((c) => c.id === calendarId),
				);
				if (!owner) return;
				await db.accounts.put({
					...owner,
					calendars: owner.calendars.map((c) => {
						if (c.id !== calendarId) return c;
						const { hidden: _h, ...rest } = c;
						return hidden ? { ...rest, hidden: true } : rest;
					}),
				});
			});
		},
		upsertAccount(a, { create = true } = {}) {
			return db.transaction(
				"rw",
				[db.accounts, db.events, db.syncState],
				async () => {
					const existing = await db.accounts.get(a.id);
					if (!existing && !create) return false;
					const order =
						existing?.order ??
						((await db.accounts.orderBy("order").last())?.order ?? -1) + 1;
					const hidden = new Map(
						existing?.calendars.map((c) => [c.id, c.hidden]) ?? [],
					);
					const calendars = a.calendars.map((c) => {
						if (!hidden.has(c.id)) return c;
						const { hidden: _h, ...rest } = c;
						return hidden.get(c.id) ? { ...rest, hidden: true } : rest;
					});
					const gone = (existing?.calendars ?? [])
						.map((c) => c.id)
						.filter((id) => !calendars.some((c) => c.id === id));
					if (gone.length) {
						await db.events.where("calendarId").anyOf(gone).delete();
						await db.syncState.bulkDelete(gone);
					}
					// Sync status belongs to this device; the provider's copy doesn't carry it.
					const { problem, dropped } = existing ?? {};
					await db.accounts.put({
						...a,
						calendars,
						order,
						...(problem ? { problem } : {}),
						...(dropped ? { dropped } : {}),
					});
					return true;
				},
			);
		},
		async removeAccount(id) {
			await db.transaction(
				"rw",
				[db.accounts, db.events, db.credentials, db.syncState, db.outbox],
				async () => {
					const account = await db.accounts.get(id);
					await db.outbox.where("accountId").equals(id).delete();
					const ids = account?.calendars.map((c) => c.id) ?? [];
					if (ids.length)
						await db.events.where("calendarId").anyOf(ids).delete();
					await db.syncState.where("accountId").equals(id).delete();
					await db.credentials.delete(id);
					await db.accounts.delete(id);
				},
			);
		},
		feeds: () => db.feeds.toArray(),
		async addFeed(calendar, url) {
			await db.transaction("rw", [db.accounts, db.feeds], async () => {
				const group = await db.accounts.get(FEEDS_ACCOUNT);
				const order =
					group?.order ??
					((await db.accounts.orderBy("order").last())?.order ?? -1) + 1;
				await db.accounts.put({
					id: FEEDS_ACCOUNT,
					label: "Subscriptions",
					provider: "ics",
					calendars: [...(group?.calendars ?? []), calendar],
					order,
				});
				await db.feeds.put({ calendarId: calendar.id, url });
			});
		},
		async applyFeed(calendarId, { feed, calendar, problem, events }) {
			await db.transaction(
				"rw",
				[db.accounts, db.feeds, db.events],
				async () => {
					const row = await db.feeds.get(calendarId);
					if (!row) return;
					await db.feeds.put({ ...row, ...feed });
					const group = await db.accounts.get(FEEDS_ACCOUNT);
					if (group)
						await db.accounts.put({
							...group,
							calendars: group.calendars.map((c) => {
								if (c.id !== calendarId) return c;
								const { problem: _p, ...rest } = { ...c, ...calendar };
								return problem ? { ...rest, problem } : rest;
							}),
						});
					if (events) {
						await db.events.where("calendarId").equals(calendarId).delete();
						await db.events.bulkPut(events);
					}
				},
			);
		},
		async removeFeed(calendarId) {
			await db.transaction(
				"rw",
				[db.accounts, db.feeds, db.events],
				async () => {
					await db.feeds.delete(calendarId);
					await db.events.where("calendarId").equals(calendarId).delete();
					const group = await db.accounts.get(FEEDS_ACCOUNT);
					if (!group) return;
					const calendars = group.calendars.filter((c) => c.id !== calendarId);
					if (calendars.length) await db.accounts.put({ ...group, calendars });
					else await db.accounts.delete(FEEDS_ACCOUNT);
				},
			);
		},
		getCredential: (accountId) => db.credentials.get(accountId),
		async putCredential(c) {
			await db.credentials.put(c);
		},
		async updateCredential(c) {
			await db.transaction("rw", db.credentials, async () => {
				if (await db.credentials.get(c.accountId)) await db.credentials.put(c);
			});
		},
		getSyncState: (calendarId) => db.syncState.get(calendarId),
		async applySync(state, changes, reset = false) {
			await db.transaction(
				"rw",
				[db.events, db.syncState, db.outbox, db.accounts],
				async () => {
					if (!(await db.accounts.get(state.accountId))) return;
					// Our own queued edits win until they're sent; the next sync brings Google's copy.
					const pending = await pendingIds();
					const put = changes.put.filter((e) => !pending.has(e.id));
					const remove = changes.remove.filter((id) => !pending.has(id));
					if (reset)
						await db.events
							.where("calendarId")
							.equals(state.calendarId)
							.filter((e) => !pending.has(e.id))
							.delete();
					if (remove.length) {
						await db.events.where("recurringEventId").anyOf(remove).delete();
						await db.events.bulkDelete(remove);
					}
					if (put.length) await db.events.bulkPut(put);
					await db.syncState.put(state);
				},
			);
		},
		async deleteEvent(id) {
			await db.transaction("rw", db.events, async () => {
				await db.events.where("recurringEventId").equals(id).delete();
				await db.events.delete(id);
			});
		},
	};
}
