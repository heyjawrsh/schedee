// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { CalendarEvent } from "@schedee/core";
import { describe, expect, it } from "vitest";
import { demoSeed } from "../../demo";
import { createLocalStore, SchedeeDB } from "../../store/db";
import { DavError, type DavRequest } from "./dav";
import { flushCalDavAccount } from "./outbox";
import {
	discover,
	ICLOUD_SERVER,
	listCalendars,
	syncCalDavAccount,
} from "./sync";

const ACCOUNT = "caldav:ada@example.com@caldav.icloud.com";
const USER = "https://p42-caldav.icloud.com/123";
const HOME = `${USER}/calendars/`;
const WORK = `${HOME}work/`;
const CAL = `${ACCOUNT}/work`;
const ZONE = "America/Chicago";

const ics = (uid: string, title: string, extra: string[] = []) =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`SUMMARY:${title}`,
		"DTSTART:20261112T150000Z",
		"DTEND:20261112T160000Z",
		...extra,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

const ms = (body: string, token?: string) =>
	`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:x="http://apple.com/ns/ical/">${body}${token ? `<d:sync-token>${token}</d:sync-token>` : ""}</d:multistatus>`;
const ok = (href: string, props: string) =>
	`<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const gone = (href: string) =>
	`<d:response><d:href>${href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
const xmlText = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const A1 = "/123/calendars/work/A1.ics";
const B2 = "/123/calendars/work/B2.ics";

/**
 * A small iCloud-shaped server. Every change bumps the collection's version; a resource's ETag is
 * the version it last changed at. Writes honor If-Match and If-None-Match.
 */
function fakeServer() {
	const objects = new Map<string, string>([
		[A1, ics("a@x", "Standup", ["RRULE:FREQ=DAILY;COUNT=3"])],
		[B2, ics("b@x", "Review")],
	]);
	let version = 1;
	const changedAt = new Map([...objects.keys()].map((k) => [k, 1]));
	const removed: { path: string; at: number }[] = [];
	const etag = (p: string) => `"${changedAt.get(p) ?? 0}"`;
	const log: string[] = [];
	const writes: string[] = [];
	let syncCollection = true;
	let writable = true;
	let password = "right";
	function set(path: string, text: string) {
		version++;
		objects.set(path, text);
		changedAt.set(path, version);
	}
	function remove(path: string) {
		version++;
		objects.delete(path);
		changedAt.delete(path);
		removed.push({ path, at: version });
	}
	const dav =
		(given: () => string): DavRequest =>
		async (method, url, { body = "", ifMatch, ifNoneMatch } = {}) => {
			const u = new URL(url);
			log.push(`${method} ${u.host}${u.pathname}`);
			const res = (status: number, b = "") => ({ status, body: b, url });
			if (given() !== password) return res(401);
			if (method === "PUT" || method === "DELETE") {
				const path = u.pathname;
				const exists = objects.has(path);
				if (ifNoneMatch && exists) return res(412);
				if (ifMatch && (!exists || ifMatch !== etag(path))) return res(412);
				if (!writable) return res(403);
				writes.push(`${method} ${path}`);
				if (method === "DELETE") {
					if (!exists) return res(404);
					remove(path);
					return res(204);
				}
				set(path, body);
				return { status: exists ? 204 : 201, body: "", url, etag: etag(path) };
			}
			if (method === "PROPFIND" && body.includes("current-user-principal"))
				return u.host === "caldav.icloud.com"
					? res(
							207,
							ms(
								ok(
									"/",
									`<d:current-user-principal><d:href>${USER}/principal/</d:href></d:current-user-principal>`,
								),
							),
						)
					: res(404);
			if (method === "PROPFIND" && body.includes("calendar-home-set"))
				return res(
					207,
					ms(
						ok(
							`${USER}/principal/`,
							`<c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`,
						),
					),
				);
			if (method === "PROPFIND" && u.pathname === "/123/calendars/")
				return res(
					207,
					ms(
						ok(
							"/123/calendars/",
							"<d:resourcetype><d:collection/></d:resourcetype>",
						) +
							ok(
								"/123/calendars/work/",
								`<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><x:calendar-color>#FF2968FF</x:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><cs:getctag>v${version}</cs:getctag><d:sync-token>t${version}</d:sync-token><d:current-user-privilege-set><d:privilege><d:read/></d:privilege>${writable ? "<d:privilege><d:write/></d:privilege>" : ""}</d:current-user-privilege-set>`,
							) +
							ok(
								"/123/calendars/tasks/",
								`<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>`,
							),
					),
				);
			if (method === "REPORT" && body.includes("sync-collection")) {
				if (!syncCollection) return res(403);
				const since = Number(/<d:sync-token>t?(\d*)</.exec(body)?.[1] || 0);
				const changed = [...changedAt]
					.filter(([, at]) => at > since)
					.map(([p]) => ok(p, `<d:getetag>${etag(p)}</d:getetag>`));
				const dropped = removed
					.filter((r) => r.at > since)
					.map((r) => gone(r.path));
				return res(207, ms(changed.join("") + dropped.join(""), `t${version}`));
			}
			if (method === "REPORT" && body.includes("calendar-query"))
				return res(
					207,
					ms(
						[...objects.keys()]
							.map((p) => ok(p, `<d:getetag>${etag(p)}</d:getetag>`))
							.join(""),
					),
				);
			if (method === "REPORT" && body.includes("calendar-multiget")) {
				const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map(
					(m) => m[1] ?? "",
				);
				return res(
					207,
					ms(
						hrefs
							.filter((h) => objects.has(h))
							.map((h) =>
								ok(
									h,
									`<d:getetag>${etag(h)}</d:getetag><c:calendar-data>${xmlText(objects.get(h) ?? "")}</c:calendar-data>`,
								),
							)
							.join(""),
					),
				);
			}
			return res(400);
		};
	return {
		dav,
		log,
		writes,
		objects,
		set,
		remove,
		noSyncCollection: () => {
			syncCollection = false;
		},
		readOnly: () => {
			writable = false;
		},
		changePassword: (p: string) => {
			password = p;
		},
	};
}

let n = 0;
async function setup() {
	const server = fakeServer();
	const dav = server.dav(() => "right");
	const store = createLocalStore(
		demoSeed,
		new SchedeeDB(`caldav-${++n}`),
		ZONE,
	);
	await store.ready;
	const home = await discover(dav, ICLOUD_SERVER);
	await store.putCredential({ accountId: ACCOUNT, keychain: true, home });
	await store.upsertAccount({
		id: ACCOUNT,
		label: "ada@example.com",
		provider: "caldav",
		calendars: [],
	});
	const sync = () =>
		syncCalDavAccount(
			store,
			{ id: ACCOUNT, label: "ada@example.com" },
			dav,
			ZONE,
		);
	const flush = () => flushCalDavAccount(store, ACCOUNT, dav, ZONE);
	const titles = async () =>
		(await store.db.events.where("calendarId").equals(CAL).toArray())
			.map((e) => e.title)
			.sort();
	const event = async (id: string) => {
		const e = await store.db.events.get(id);
		if (!e) throw new Error(`no event ${id}`);
		return e;
	};
	return { server, dav, store, sync, flush, titles, event, home };
}

describe("CalDAV sync", () => {
	it("finds the calendar home through the principal, across iCloud hosts", async () => {
		const { home } = await setup();
		expect(home).toBe(HOME);
	});

	it("turns down a wrong password", async () => {
		const server = fakeServer();
		await expect(
			discover(
				server.dav(() => "wrong"),
				ICLOUD_SERVER,
			),
		).rejects.toEqual(new DavError(401));
	});

	it("lists only calendars that hold events, with names, colors and access", async () => {
		const { dav, server } = await setup();
		expect(await listCalendars(dav, HOME)).toEqual([
			{
				href: WORK,
				name: "Work",
				color: "#FF2968",
				ctag: "v1",
				syncToken: "t1",
				writable: true,
			},
		]);
		server.readOnly();
		expect((await listCalendars(dav, HOME))[0]?.writable).toBe(false);
	});

	it("loads every event, named after its resource, and keeps the server's copy", async () => {
		const { store, sync, titles, event } = await setup();
		expect(await sync()).toEqual({ calendars: 1, changed: 2 });
		expect(await titles()).toEqual(["Review", "Standup"]);
		expect((await store.db.accounts.get(ACCOUNT))?.calendars).toEqual([
			{ id: CAL, name: "Work", color: "#FF2968" },
		]);
		expect((await event(`${CAL}#A1`)).recurrence?.rrule).toBe(
			"FREQ=DAILY;COUNT=3",
		);
		expect(await store.davObject(`${CAL}#A1`)).toMatchObject({
			href: `${WORK}A1.ics`,
			etag: '"1"',
		});
	});

	it("pulls only what changed, and skips a calendar whose tag hasn't moved", async () => {
		const { server, sync, titles } = await setup();
		await sync();
		server.log.length = 0;
		await sync();
		expect(server.log.filter((l) => l.startsWith("REPORT"))).toEqual([]);

		server.set(A1, ics("a@x", "Standup (moved)"));
		server.remove(B2);
		server.set("/123/calendars/work/C3.ics", ics("c@x", "Lunch"));
		server.log.length = 0;
		expect(await sync()).toEqual({ calendars: 1, changed: 3 });
		expect(await titles()).toEqual(["Lunch", "Standup (moved)"]);
		// sync-collection, then one multiget
		expect(server.log.filter((l) => l.startsWith("REPORT"))).toHaveLength(2);
	});

	it("drops an override that left its resource", async () => {
		const { server, store, sync } = await setup();
		const withOverride = [
			ics("a@x", "Standup", ["RRULE:FREQ=DAILY;COUNT=3"]).replace(
				"END:VCALENDAR",
				"",
			),
			"BEGIN:VEVENT",
			"UID:a@x",
			"SUMMARY:Standup (late)",
			"RECURRENCE-ID:20261113T150000Z",
			"DTSTART:20261113T170000Z",
			"DTEND:20261113T180000Z",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");
		server.set(A1, withOverride);
		await sync();
		const overrides = () =>
			store.db.events.where("recurringEventId").equals(`${CAL}#A1`).count();
		expect(await overrides()).toBe(1);
		server.set(A1, ics("a@x", "Standup", ["RRULE:FREQ=DAILY;COUNT=3"]));
		await sync();
		expect(await overrides()).toBe(0);
	});

	it("falls back to a full listing on servers without sync-collection", async () => {
		const { server, sync, titles } = await setup();
		server.noSyncCollection();
		await sync();
		expect(await titles()).toEqual(["Review", "Standup"]);
		server.remove(B2);
		await sync();
		expect(await titles()).toEqual(["Standup"]);
	});

	it("stops with a 401 when the password stops working", async () => {
		const { server, sync } = await setup();
		server.changePassword("new");
		await expect(sync()).rejects.toEqual(new DavError(401));
	});

	it("marks the signed-in user among guests, so others' invites stay read-only", async () => {
		const { server, sync, event } = await setup();
		server.set(
			"/123/calendars/work/M1.ics",
			ics("m@x", "Planning", [
				"ORGANIZER:mailto:grace@example.com",
				"ATTENDEE;PARTSTAT=ACCEPTED:mailto:grace@example.com",
				"ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:Ada@Example.com",
			]),
		);
		await sync();
		expect((await event(`${CAL}#M1`)).attendees).toEqual([
			{ email: "grace@example.com", rsvp: "accepted", organizer: true },
			{ email: "ada@example.com", rsvp: "needsAction", self: true },
		]);
	});
});

describe("CalDAV writes", () => {
	it("sends an edit as the whole resource, over the version it replaces", async () => {
		const { server, store, sync, flush, event } = await setup();
		await sync();
		const before = await event(`${CAL}#B2`);
		expect(
			await store.commit({
				put: [
					{
						...before,
						title: "Review (moved)",
						start: "2026-11-12T11:00:00",
						end: "2026-11-12T12:00:00",
					},
				],
				remove: [],
			}),
		).toBe(1);
		expect(await flush()).toEqual({ sent: 1 });
		expect(server.writes).toEqual([`PUT ${B2}`]);
		expect(server.objects.get(B2)).toContain("SUMMARY:Review (moved)");
		expect(server.objects.get(B2)).toContain(
			"DTSTART;TZID=America/Chicago:20261112T110000",
		);
		expect(await store.pendingDavWrites(ACCOUNT)).toEqual([]);
		// The next sync brings the same event back, not a copy.
		await sync();
		expect(
			(await store.db.events.where("calendarId").equals(CAL).toArray())
				.map((e) => e.id)
				.sort(),
		).toEqual([`${CAL}#A1`, `${CAL}#B2`]);
		expect((await event(`${CAL}#B2`)).start).toBe("2026-11-12T11:00:00");
	});

	it("creates a new event under its own name, and deletes one", async () => {
		const { server, store, sync, flush, titles } = await setup();
		await sync();
		const created: CalendarEvent = {
			id: `${CAL}#n1`,
			calendarId: CAL,
			title: "Lunch",
			start: "2026-11-14T12:00:00",
			end: "2026-11-14T13:00:00",
			allDay: false,
			timeZone: ZONE,
		};
		await store.commit({ put: [created], remove: [`${CAL}#A1`] });
		expect(await flush()).toEqual({ sent: 2 });
		expect(server.writes.sort()).toEqual([
			`DELETE ${A1}`,
			"PUT /123/calendars/work/n1.ics",
		]);
		await sync();
		expect(await titles()).toEqual(["Lunch", "Review"]);
	});

	it("keeps local edits through a sync until they're sent", async () => {
		const { store, sync, event } = await setup();
		await sync();
		const b = await event(`${CAL}#B2`);
		await store.commit({ put: [{ ...b, title: "Mine" }], remove: [] });
		await store.applySync(
			{ calendarId: CAL, accountId: ACCOUNT },
			{ put: [{ ...b, title: "Theirs" }], remove: [] },
			true,
		);
		expect((await event(`${CAL}#B2`)).title).toBe("Mine");
	});

	it("drops an edit to an event that changed on the server first, and reloads it", async () => {
		const { server, store, sync, flush, event } = await setup();
		await sync();
		server.set(B2, ics("b@x", "Review (their change)"));
		const b = await event(`${CAL}#B2`);
		await store.commit({ put: [{ ...b, title: "Review (mine)" }], remove: [] });
		await flush();
		expect(server.writes).toEqual([]);
		expect((await store.db.accounts.get(ACCOUNT))?.dropped).toBe(1);
		await sync();
		expect((await event(`${CAL}#B2`)).title).toBe("Review (their change)");
	});

	it("keeps an edit made while the previous one was sending", async () => {
		const { store, sync, flush, event, server } = await setup();
		await sync();
		const b = await event(`${CAL}#B2`);
		await store.commit({ put: [{ ...b, title: "One" }], remove: [] });
		const [queued] = await store.pendingDavWrites(ACCOUNT);
		if (!queued) throw new Error("not queued");
		await store.commit({ put: [{ ...b, title: "Two" }], remove: [] });
		// The first send lands; the second edit is still waiting.
		await store.finishDavWrite(
			queued,
			(await store.davObject(queued.id)) ?? null,
		);
		expect(await store.pendingDavWrites(ACCOUNT)).toHaveLength(1);
		await flush();
		expect(server.objects.get(B2)).toContain("SUMMARY:Two");
	});

	it("waits offline, and stops with a 401 when the password stops working", async () => {
		const { store, sync, event, server } = await setup();
		await sync();
		const b = await event(`${CAL}#B2`);
		await store.commit({ put: [{ ...b, title: "Later" }], remove: [] });
		const offline: DavRequest = async () => {
			throw new TypeError("network: offline");
		};
		expect(await flushCalDavAccount(store, ACCOUNT, offline, ZONE)).toEqual({
			sent: 0,
			stopped: "offline",
		});
		expect(await store.pendingDavWrites(ACCOUNT)).toHaveLength(1);
		server.changePassword("new");
		await expect(
			flushCalDavAccount(
				store,
				ACCOUNT,
				server.dav(() => "right"),
				ZONE,
			),
		).rejects.toEqual(new DavError(401));
		expect(await store.pendingDavWrites(ACCOUNT)).toHaveLength(1);
	});
});
