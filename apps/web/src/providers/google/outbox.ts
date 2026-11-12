import type { GoogleEvent, GoogleInstanceRef } from "@schedee/core";
import type { LocalStore, QueuedWrite } from "../../store/db";
import { GoogleAuthError } from "./auth";
import { type Fetcher, GoogleApiError, googleFetcher } from "./sync";

/** What happened to an account's queue. `stopped` says why sending paused, if it did. */
export interface FlushResult {
	sent: number;
	dropped: number;
	stopped?: "offline" | "auth" | "busy";
}

const RATE_LIMITED = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/;

/** Fails that may work later (Google busy or us offline) versus fails that never will. */
function classify(e: unknown): "retry" | "auth" | "drop" | "offline" {
	if (e instanceof GoogleAuthError) return "auth";
	if (e instanceof GoogleApiError) {
		if (e.status === 401) return "auth";
		if (e.status === 429 || e.status >= 500) return "retry";
		if (e.status === 403 && RATE_LIMITED.test(e.message)) return "retry";
		return "drop";
	}
	// fetch rejects with a TypeError when there's no network.
	return "offline";
}

const is = (e: unknown, ...status: number[]) =>
	e instanceof GoogleApiError && status.includes(e.status);

/** Google's current id for one occurrence, in case our computed one is off. */
async function findInstance(
	get: Fetcher,
	calendar: string,
	ref: GoogleInstanceRef,
): Promise<string | undefined> {
	const page = await get<{ items?: GoogleEvent[] }>(
		`/calendars/${calendar}/events/${encodeURIComponent(ref.seriesId)}/instances`,
		{ originalStart: ref.originalStart, showDeleted: "true" },
	);
	return page?.items?.[0]?.id;
}

async function send(get: Fetcher, w: QueuedWrite): Promise<void> {
	const calendar = encodeURIComponent(w.calendarId);
	const updates = { sendUpdates: w.notify ? "all" : "none" };
	const events = `/calendars/${calendar}/events`;
	switch (w.kind) {
		case "insert":
			try {
				await get(events, updates, { method: "POST", body: w.body });
			} catch (e) {
				// The id exists: this undoes a delete, and Google keeps deleted events as cancelled.
				if (!is(e, 409)) throw e;
				const { id, ...body } = w.body;
				await get(`${events}/${encodeURIComponent(id ?? "")}`, updates, {
					method: "PATCH",
					body: { ...body, status: "confirmed" },
				});
			}
			return;
		case "patch":
		case "delete": {
			const method = w.kind === "patch" ? "PATCH" : "DELETE";
			const body = w.kind === "patch" ? w.body : undefined;
			const to = (id: string) =>
				get(`${events}/${encodeURIComponent(id)}`, updates, {
					method,
					...(body ? { body } : {}),
				});
			try {
				await to(w.eventId);
			} catch (e) {
				if (w.kind === "delete" && is(e, 410)) return;
				if (!is(e, 404)) throw e;
				const found = w.instance
					? await findInstance(get, calendar, w.instance)
					: undefined;
				if (found && found !== w.eventId) await to(found);
				else if (w.kind === "patch") throw e;
			}
			return;
		}
		case "move":
			await get(
				`${events}/${encodeURIComponent(w.eventId)}/move`,
				{ ...updates, destination: w.destination },
				{ method: "POST" },
			);
			return;
	}
}

/**
 * Sends an account's queued writes in order. Stops at the first write that might work later, so
 * edits never reach Google out of order.
 */
export async function flushGoogleAccount(
	store: LocalStore,
	accountId: string,
	authUrl: string,
): Promise<FlushResult> {
	const get = googleFetcher(store, accountId, authUrl);
	const result: FlushResult = { sent: 0, dropped: 0 };
	for (const w of await store.pendingWrites(accountId)) {
		const seq = w.seq as number;
		try {
			await send(get, w);
			await store.finishWrite(seq);
			result.sent++;
		} catch (e) {
			const why =
				e instanceof GoogleApiError
					? `HTTP ${e.status}`
					: e instanceof GoogleAuthError
						? e.code
						: String(e);
			const kind = classify(e);
			if (kind === "drop") {
				await store.dropWrite(seq, why);
				result.dropped++;
				continue;
			}
			await store.retryWrite(seq, why);
			result.stopped = kind === "retry" ? "busy" : kind;
			break;
		}
	}
	return result;
}
