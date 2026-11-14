// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { demoSeed } from "../../demo";
import { createLocalStore, SchedeeDB } from "../../store/db";
import { DavError, type DavRequest } from "./dav";
import { discover, ICLOUD_SERVER, listCalendars, syncCalDavAccount } from "./sync";

const ACCOUNT = "caldav:ada@example.com@caldav.icloud.com";
const USER = "https://p42-caldav.icloud.com/123";
const HOME = `${USER}/calendars/`;
const WORK = `${HOME}work/`;

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

/** A small iCloud-shaped server. Resources live in `objects`; every change bumps the token. */
function fakeServer() {
	const objects = new Map<string, string>([
		["/123/calendars/work/A1.ics", ics("a@x", "Standup", ["RRULE:FREQ=DAILY;COUNT=3"])],
		["/123/calendars/work/B2.ics", ics("b@x", "Review")],
	]);
	let version = 1;
	const removed: { path: string; at: number }[] = [];
	const changedAt = new Map([...objects.keys()].map((k) => [k, 1]));
	const log: string[] = [];
	let syncCollection = true;
	let password = "right";
	const dav =
		(given: () => string): DavRequest =>
		async (method, url, _depth, body = "") => {
			const u = new URL(url);
			log.push(`${method} ${u.host}${u.pathname}`);
			const res = (status: number, b = "") => ({ status, body: b, url });
			if (given() !== password) return res(401);
			if (method === "PROPFIND" && body.includes("current-user-principal"))
				return u.host === "caldav.icloud.com"
					? res(207, ms(ok("/", `<d:current-user-principal><d:href>${USER}/principal/</d:href></d:current-user-principal>`)))
					: res(404);
			if (method === "PROPFIND" && body.includes("calendar-home-set"))
				return res(207, ms(ok(`${USER}/principal/`, `<c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`)));
			if (method === "PROPFIND" && u.pathname === "/123/calendars/")
				return res(
					207,
					ms(
						ok("/123/calendars/", "<d:resourcetype><d:collection/></d:resourcetype>") +
							ok(
								"/123/calendars/work/",
								`<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><x:calendar-color>#FF2968FF</x:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><cs:getctag>v${version}</cs:getctag><d:sync-token>t${version}</d:sync-token>`,
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
				const changed = [...changedAt].filter(([, at]) => at > since).map(([p]) => ok(p, '<d:getetag>"e"</d:getetag>'));
				const dropped = removed.filter((r) => r.at > since).map((r) => gone(r.path));
				return res(207, ms(changed.join("") + dropped.join(""), `t${version}`));
			}
			if (method === "REPORT" && body.includes("calendar-query"))
				return res(207, ms([...objects.keys()].map((p) => ok(p, '<d:getetag>"e"</d:getetag>')).join("")));
			if (method === "REPORT" && body.includes("calendar-multiget")) {
				const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1] ?? "");
				return res(
					207,
					ms(hrefs.filter((h) => objects.has(h)).map((h) => ok(h, `<c:calendar-data>${objects.get(h)}</c:calendar-data>`)).join("")),
				);
			}
			return res(400);
		};
	return {
		dav,
		log,
		set: (path: string, text: string) => {
			version++;
			objects.set(path, text);
			changedAt.set(path, version);
		},
		remove: (path: string) => {
			version++;
			objects.delete(path);
			changedAt.delete(path);
			removed.push({ path, at: version });
		},
		noSyncCollection: () => {
			syncCollection = false;
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
	const store = createLocalStore(demoSeed, new SchedeeDB(`caldav-${++n}`));
	await store.ready;
	const home = await discover(dav, ICLOUD_SERVER);
	await store.putCredential({ accountId: ACCOUNT, keychain: true, home });
	await store.upsertAccount({ id: ACCOUNT, label: "ada@example.com", provider: "caldav", calendars: [] });
	const sync = () =>
		syncCalDavAccount(store, { id: ACCOUNT, label: "ada@example.com" }, dav, "America/Chicago");
	const titles = async () =>
		(await store.db.events.where("calendarId").equals(`${ACCOUNT}/work`).toArray())
			.map((e) => e.title)
			.sort();
	return { server, dav, store, sync, titles, home };
}

describe("CalDAV", () => {
	it("finds the calendar home through the principal, across iCloud hosts", async () => {
		const { home } = await setup();
		expect(home).toBe(HOME);
	});

	it("turns down a wrong password", async () => {
		const server = fakeServer();
		await expect(discover(server.dav(() => "wrong"), ICLOUD_SERVER)).rejects.toEqual(new DavError(401));
	});

	it("lists only calendars that hold events, with their names and colors", async () => {
		const { dav } = await setup();
		expect(await listCalendars(dav, HOME)).toEqual([
			{ href: WORK, name: "Work", color: "#FF2968", ctag: "v1", syncToken: "t1" },
		]);
	});

	it("loads every event, read-only, named after its resource", async () => {
		const { store, sync, titles } = await setup();
		expect(await sync()).toEqual({ calendars: 1, changed: 2 });
		expect(await titles()).toEqual(["Review", "Standup"]);
		const account = await store.db.accounts.get(ACCOUNT);
		expect(account?.calendars).toEqual([
			{ id: `${ACCOUNT}/work`, name: "Work", color: "#FF2968", readOnly: true },
		]);
		expect((await store.db.events.get(`${ACCOUNT}/work#A1.ics`))?.recurrence?.rrule).toBe(
			"FREQ=DAILY;COUNT=3",
		);
	});

	it("pulls only what changed, and skips a calendar whose tag hasn't moved", async () => {
		const { server, sync, titles } = await setup();
		await sync();
		server.log.length = 0;
		await sync();
		expect(server.log.filter((l) => l.startsWith("REPORT"))).toEqual([]);

		server.set("/123/calendars/work/A1.ics", ics("a@x", "Standup (moved)"));
		server.remove("/123/calendars/work/B2.ics");
		server.set("/123/calendars/work/C3.ics", ics("c@x", "Lunch"));
		server.log.length = 0;
		expect(await sync()).toEqual({ calendars: 1, changed: 3 });
		expect(await titles()).toEqual(["Lunch", "Standup (moved)"]);
		const multiget = server.log.filter((l) => l.startsWith("REPORT")).length;
		expect(multiget).toBe(2); // sync-collection, then one multiget
	});

	it("drops an override that left its resource", async () => {
		const { server, store, sync } = await setup();
		server.set(
			"/123/calendars/work/A1.ics",
			[
				ics("a@x", "Standup", ["RRULE:FREQ=DAILY;COUNT=3"]).replace("END:VCALENDAR", ""),
				"BEGIN:VEVENT",
				"UID:a@x",
				"SUMMARY:Standup (late)",
				"RECURRENCE-ID:20261113T150000Z",
				"DTSTART:20261113T170000Z",
				"DTEND:20261113T180000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n"),
		);
		await sync();
		expect(await store.db.events.where("recurringEventId").equals(`${ACCOUNT}/work#A1.ics`).count()).toBe(1);
		server.set("/123/calendars/work/A1.ics", ics("a@x", "Standup", ["RRULE:FREQ=DAILY;COUNT=3"]));
		await sync();
		expect(await store.db.events.where("recurringEventId").equals(`${ACCOUNT}/work#A1.ics`).count()).toBe(0);
	});

	it("falls back to a full listing on servers without sync-collection", async () => {
		const { server, sync, titles } = await setup();
		server.noSyncCollection();
		await sync();
		expect(await titles()).toEqual(["Review", "Standup"]);
		server.remove("/123/calendars/work/B2.ics");
		await sync();
		expect(await titles()).toEqual(["Standup"]);
	});

	it("stops with a 401 when the password stops working", async () => {
		const { server, sync } = await setup();
		server.changePassword("new");
		await expect(sync()).rejects.toEqual(new DavError(401));
	});
});
