/**
 * Sends local edits to a CalDAV server, one whole resource at a time. Each PUT or DELETE names the
 * version it replaces (If-Match), so an event changed elsewhere since our last sync isn't
 * overwritten: our edit is dropped and the calendar reloads from the server instead.
 */
import { writeCalendarObject } from "@schedee/core";
import type { DavWrite, LocalStore } from "../../store/db";
import { DavError, type DavRequest } from "./dav";

/** Worth another try later: the server is busy or broken right now. */
const transient = (status: number) => status === 429 || status >= 500;
const ok = (status: number) => status >= 200 && status < 300;

async function send(
	store: LocalStore,
	dav: DavRequest,
	w: DavWrite,
	zone: string,
): Promise<"sent" | "later"> {
	const object = await store.davObject(w.id);
	const key = w.id.slice(w.calendarId.length + 1);
	const events = [
		...(await store.db.events.where("id").equals(w.id).toArray()),
		...(await store.db.events.where("recurringEventId").equals(w.id).toArray()),
	];

	let status: number;
	if (!events.length) {
		// Gone here. Never sent: nothing to do.
		if (!object) {
			await store.finishDavWrite(w, null);
			return "sent";
		}
		const res = await dav(
			"DELETE",
			object.href,
			object.etag ? { ifMatch: object.etag } : {},
		);
		status = res.status;
		if (ok(status) || status === 404) {
			await store.finishDavWrite(w, null);
			return "sent";
		}
	} else {
		const calendarHref = (await store.getSyncState(w.calendarId))?.href;
		const href =
			object?.href ??
			(calendarHref &&
				new URL(`${encodeURIComponent(key)}.ics`, calendarHref).toString());
		// The calendar hasn't synced yet, so we don't know where to put it.
		if (!href) return "later";
		const label = (await store.db.accounts.get(w.accountId))?.label;
		const ics = writeCalendarObject({
			original: object?.ics,
			calendarId: w.calendarId,
			key,
			events,
			fallbackZone: zone,
			...(label?.includes("@") ? { organizer: label } : {}),
		});
		const res = await dav("PUT", href, {
			body: ics,
			contentType: "text/calendar",
			...(object?.etag
				? { ifMatch: object.etag }
				: object
					? {}
					: { ifNoneMatch: true }),
		});
		status = res.status;
		if (ok(status)) {
			await store.finishDavWrite(w, {
				id: w.id,
				calendarId: w.calendarId,
				href,
				ics,
				...(res.etag ? { etag: res.etag } : {}),
			});
			return "sent";
		}
	}
	if (status === 401) throw new DavError(401);
	if (transient(status)) {
		await store.retryDavWrite(w.id, `HTTP ${status}`);
		return "later";
	}
	// 412: it changed on the server first. Anything else: the server won't take it.
	await store.dropDavWrite(
		w.id,
		status === 412 ? "changed on the server" : `HTTP ${status}`,
	);
	return "sent";
}

/**
 * Sends one account's queued resources. Stops quietly when the connection drops (they go out
 * next time) and throws DavError(401) when the login stops working.
 */
export async function flushCalDavAccount(
	store: LocalStore,
	accountId: string,
	dav: DavRequest,
	zone: string,
): Promise<{ sent: number; stopped?: "offline" }> {
	let sent = 0;
	for (const w of await store.pendingDavWrites(accountId)) {
		try {
			if ((await send(store, dav, w, zone)) === "sent") sent++;
		} catch (e) {
			if (e instanceof TypeError) return { sent, stopped: "offline" };
			throw e;
		}
	}
	return { sent };
}
