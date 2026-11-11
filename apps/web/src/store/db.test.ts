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
});
