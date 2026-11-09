import type { Account, CalendarEvent, CalendarSnapshot } from "@schedee/core";
import { Dexie, type EntityTable, liveQuery } from "dexie";

/** Local-first storage for calendars and events (IndexedDB in the browser and in the Tauri webview). */
/** Accounts carry their position so the sidebar keeps the order they were added in. */
type StoredAccount = Account & { order: number };

export class SchedeeDB extends Dexie {
	accounts!: EntityTable<StoredAccount, "id">;
	events!: EntityTable<CalendarEvent, "id">;

	constructor(name = "schedee") {
		super(name);
		this.version(1).stores({
			accounts: "id, order",
			events: "id, calendarId, recurringEventId, start",
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
		async deleteEvent(id) {
			await db.transaction("rw", db.events, async () => {
				await db.events.where("recurringEventId").equals(id).delete();
				await db.events.delete(id);
			});
		},
	};
}
