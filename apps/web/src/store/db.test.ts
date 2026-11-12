import "fake-indexeddb/auto";
import type { CalendarEvent } from "@schedee/core";
import { describe, expect, it } from "vitest";
import { createLocalStore, SchedeeDB } from "./db";

let n = 0;
const fresh = () => new SchedeeDB(`test-${++n}`);
const seed = () => ({
	accounts: [
		{
			id: "local",
			label: "On this device",
			calendars: [{ id: "personal", name: "Personal", color: "#757AFF" }],
		},
	],
	events: [
		{
			id: "a",
			calendarId: "personal",
			title: "A",
			start: "2026-11-09T10:00",
			end: "2026-11-09T11:00",
			allDay: false,
		},
	] as CalendarEvent[],
});
const next = <T>(
	store: ReturnType<typeof createLocalStore>,
	pick: (s: { events: CalendarEvent[] }) => T,
) =>
	new Promise<T>((resolve) => {
		const off = store.subscribe((s) => {
			off();
			resolve(pick(s));
		});
	});

describe("local store", () => {
	it("seeds once and survives reopening", async () => {
		const db = fresh();
		const store = createLocalStore(seed, db);
		await store.ready;
		await store.putEvent({
			id: "b",
			calendarId: "personal",
			title: "B",
			start: "2026-11-10",
			end: "2026-11-11",
			allDay: true,
		});
		db.close();
		await db.open();
		const again = createLocalStore(() => {
			throw new Error("must not reseed");
		}, db);
		await again.ready;
		expect(
			(await next(again, (s) => s.events.map((e) => e.id))).sort(),
		).toEqual(["a", "b"]);
	});

	it("deletes a series together with its overrides", async () => {
		const store = createLocalStore(seed, fresh());
		await store.ready;
		await store.putEvent({
			id: "s",
			calendarId: "personal",
			title: "S",
			start: "2026-11-09T09:00",
			end: "2026-11-09T09:15",
			allDay: false,
			recurrence: { rrule: "FREQ=DAILY" },
		});
		await store.putEvent({
			id: "s1",
			calendarId: "personal",
			title: "S moved",
			start: "2026-11-10T12:00",
			end: "2026-11-10T12:15",
			allDay: false,
			recurringEventId: "s",
			originalStart: "2026-11-10T09:00:00",
		});
		await store.deleteEvent("s");
		expect(
			(await next(store, (s) => s.events.map((e) => e.id))).sort(),
		).toEqual(["a"]);
	});

	it("hides and shows a calendar", async () => {
		const db = fresh();
		const store = createLocalStore(seed, db);
		await store.ready;
		await store.setCalendarHidden("personal", true);
		expect((await db.accounts.get("local"))?.calendars[0]?.hidden).toBe(true);
		await store.setCalendarHidden("personal", false);
		expect((await db.accounts.get("local"))?.calendars[0]).not.toHaveProperty(
			"hidden",
		);
	});

	it("keeps local hides on account refresh and drops vanished calendars", async () => {
		const db = fresh();
		const store = createLocalStore(seed, db);
		await store.ready;
		const cal = (id: string) => ({ id, name: id, color: "#000000" });
		await store.upsertAccount({
			id: "g",
			label: "g",
			provider: "google",
			calendars: [cal("g/a"), cal("g/b")],
		});
		await store.setCalendarHidden("g/a", true);
		await store.applySync(
			{ calendarId: "g/b", accountId: "g", syncToken: "t1" },
			{
				put: [
					{
						id: "g/b#1",
						calendarId: "g/b",
						title: "B1",
						start: "2026-11-10T09:00",
						end: "2026-11-10T10:00",
						allDay: false,
					},
				],
				remove: [],
			},
		);
		await store.upsertAccount({
			id: "g",
			label: "g",
			provider: "google",
			calendars: [cal("g/a")],
		});
		const account = await db.accounts.get("g");
		expect(account?.calendars).toEqual([{ ...cal("g/a"), hidden: true }]);
		expect(await db.events.get("g/b#1")).toBeUndefined();
		expect(await store.getSyncState("g/b")).toBeUndefined();
	});

	it("resets a calendar on a full resync and removes everything with the account", async () => {
		const db = fresh();
		const store = createLocalStore(seed, db);
		await store.ready;
		await store.upsertAccount({
			id: "g",
			label: "g",
			provider: "google",
			calendars: [{ id: "g/a", name: "a", color: "#000000" }],
		});
		await store.putCredential({ accountId: "g", refreshToken: "r" });
		const ev = (id: string) => ({
			id,
			calendarId: "g/a",
			title: id,
			start: "2026-11-10T09:00",
			end: "2026-11-10T10:00",
			allDay: false,
		});
		const state = { calendarId: "g/a", accountId: "g", syncToken: "t" };
		await store.applySync(state, { put: [ev("old")], remove: [] });
		await store.applySync(state, { put: [ev("new")], remove: [] }, true);
		expect(
			(await db.events.where("calendarId").equals("g/a").toArray()).map(
				(e) => e.id,
			),
		).toEqual(["new"]);
		await store.removeAccount("g");
		expect(await db.accounts.get("g")).toBeUndefined();
		expect(await db.events.where("calendarId").equals("g/a").count()).toBe(0);
		expect(await store.getCredential("g")).toBeUndefined();
		expect(await store.getSyncState("g/a")).toBeUndefined();
	});

	it("queues writes for synced calendars and keeps them through a sync", async () => {
		const db = fresh();
		const store = createLocalStore(seed, db, "America/Chicago");
		await store.ready;
		await store.upsertAccount({
			id: "g",
			label: "g",
			provider: "google",
			calendars: [{ id: "g/cal", name: "cal", color: "#000000" }],
		});
		const ev = (title: string): CalendarEvent => ({
			id: "g/cal#abc12",
			calendarId: "g/cal",
			title,
			start: "2026-11-10T09:00:00",
			end: "2026-11-10T10:00:00",
			allDay: false,
		});
		expect(
			await store.commit({
				put: [{ ...seed().events[0], title: "A2" } as CalendarEvent],
				remove: [],
			}),
		).toBe(0);
		expect(await store.commit({ put: [ev("Mine")], remove: [] })).toBe(1);
		const [w] = await store.pendingWrites("g");
		expect(w).toMatchObject({
			kind: "insert",
			calendarId: "cal",
			body: { id: "abc12", start: { timeZone: "America/Chicago" } },
		});

		// A sync that lands before the write is sent doesn't undo it, even a full reset.
		const state = { calendarId: "g/cal", accountId: "g", syncToken: "t" };
		await store.applySync(state, { put: [ev("Theirs")], remove: [] }, true);
		expect((await db.events.get("g/cal#abc12"))?.title).toBe("Mine");

		await store.finishWrite(w?.seq as number);
		await store.applySync(state, { put: [ev("Theirs")], remove: [] });
		expect((await db.events.get("g/cal#abc12"))?.title).toBe("Theirs");
	});

	it("drops a refused write and resyncs its calendar", async () => {
		const db = fresh();
		const store = createLocalStore(seed, db);
		await store.ready;
		await store.upsertAccount({
			id: "g",
			label: "g",
			provider: "google",
			calendars: [{ id: "g/cal", name: "cal", color: "#000000" }],
		});
		await store.applySync(
			{ calendarId: "g/cal", accountId: "g", syncToken: "t" },
			{ put: [], remove: [] },
		);
		await store.commit({
			put: [
				{
					id: "g/cal#abc12",
					calendarId: "g/cal",
					title: "x",
					start: "2026-11-10",
					end: "2026-11-11",
					allDay: true,
				},
			],
			remove: [],
		});
		const [w] = await store.pendingWrites("g");
		await store.retryWrite(w?.seq as number, "HTTP 503");
		expect((await store.pendingWrites("g"))[0]?.tries).toBe(1);
		await store.dropWrite(w?.seq as number, "HTTP 400");
		expect(await store.pendingWrites("g")).toEqual([]);
		expect(await store.getSyncState("g/cal")).toEqual({
			calendarId: "g/cal",
			accountId: "g",
		});
		// The user hears about it once, until they dismiss it.
		expect((await db.accounts.get("g"))?.dropped).toBe(1);
		await store.dismissDropped("g");
		expect((await db.accounts.get("g"))?.dropped).toBeUndefined();
	});

	it("keeps an account's sync status through a calendar list refresh", async () => {
		const db = fresh();
		const store = createLocalStore(seed, db);
		await store.ready;
		const account = {
			id: "g",
			label: "g",
			provider: "google" as const,
			calendars: [{ id: "g/cal", name: "cal", color: "#000000" }],
		};
		await store.upsertAccount(account);
		await store.setAccountProblem("g", "signed_out");
		await store.upsertAccount(account);
		expect((await db.accounts.get("g"))?.problem).toBe("signed_out");
		await store.setAccountProblem("g", undefined);
		expect((await db.accounts.get("g"))?.problem).toBeUndefined();
	});
});
