import type { Account, CalendarEvent, CalendarSnapshot } from "@schedee/core";
import { Dexie, type EntityTable, liveQuery } from "dexie";

/** Local-first storage for calendars and events (IndexedDB in the browser and in the Tauri webview). */
/** Accounts carry their position so the sidebar keeps the order they were added in. */
type StoredAccount = Account & { order: number };

/** OAuth tokens for a synced account. Kept on the device only. */
export interface Credential {
	accountId: string;
	refreshToken: string;
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

export class SchedeeDB extends Dexie {
	accounts!: EntityTable<StoredAccount, "id">;
	events!: EntityTable<CalendarEvent, "id">;
	credentials!: EntityTable<Credential, "accountId">;
	syncState!: EntityTable<SyncState, "calendarId">;

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
	/** Applies an edit result (puts and removals) atomically. */
	commit(r: { put: CalendarEvent[]; remove: string[] }): Promise<void>;
	setCalendarHidden(calendarId: string, hidden: boolean): Promise<void>;
	/**
	 * Adds an account or refreshes its calendar list. Calendars the user hid here stay hidden;
	 * calendars that disappeared take their events and sync state with them.
	 */
	upsertAccount(a: Account): Promise<void>;
	/** Removes an account with its calendars, events, tokens and sync state. */
	removeAccount(id: string): Promise<void>;
	getCredential(accountId: string): Promise<Credential | undefined>;
	putCredential(c: Credential): Promise<void>;
	getSyncState(calendarId: string): Promise<SyncState | undefined>;
	/**
	 * Applies one calendar's sync results. With `reset`, the calendar's events are replaced
	 * (a full resync after the server dropped our sync token).
	 */
	applySync(
		state: SyncState,
		changes: { put: CalendarEvent[]; remove: string[] },
		reset?: boolean,
	): Promise<void>;
}

export function createLocalStore(
	seed: () => Pick<CalendarSnapshot, "accounts" | "events">,
	db: SchedeeDB = new SchedeeDB(),
): LocalStore {
	const ready = db.transaction("rw", db.accounts, db.events, async () => {
		if ((await db.accounts.count()) > 0) return;
		const s = seed();
		await db.accounts.bulkPut(s.accounts.map((a, order) => ({ ...a, order })));
		await db.events.bulkPut(s.events);
	});
	return {
		db,
		ready,
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
		async commit({ put, remove }) {
			await db.transaction("rw", db.events, async () => {
				if (remove.length) await db.events.bulkDelete(remove);
				if (put.length) await db.events.bulkPut(put);
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
		async upsertAccount(a) {
			await db.transaction(
				"rw",
				[db.accounts, db.events, db.syncState],
				async () => {
					const existing = await db.accounts.get(a.id);
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
					await db.accounts.put({ ...a, calendars, order });
				},
			);
		},
		async removeAccount(id) {
			await db.transaction(
				"rw",
				[db.accounts, db.events, db.credentials, db.syncState],
				async () => {
					const account = await db.accounts.get(id);
					const ids = account?.calendars.map((c) => c.id) ?? [];
					if (ids.length)
						await db.events.where("calendarId").anyOf(ids).delete();
					await db.syncState.where("accountId").equals(id).delete();
					await db.credentials.delete(id);
					await db.accounts.delete(id);
				},
			);
		},
		getCredential: (accountId) => db.credentials.get(accountId),
		async putCredential(c) {
			await db.credentials.put(c);
		},
		getSyncState: (calendarId) => db.syncState.get(calendarId),
		async applySync(state, { put, remove }, reset = false) {
			await db.transaction("rw", [db.events, db.syncState], async () => {
				if (reset)
					await db.events.where("calendarId").equals(state.calendarId).delete();
				if (remove.length) {
					await db.events.where("recurringEventId").anyOf(remove).delete();
					await db.events.bulkDelete(remove);
				}
				if (put.length) await db.events.bulkPut(put);
				await db.syncState.put(state);
			});
		},
		async deleteEvent(id) {
			await db.transaction("rw", db.events, async () => {
				await db.events.where("recurringEventId").equals(id).delete();
				await db.events.delete(id);
			});
		},
	};
}
