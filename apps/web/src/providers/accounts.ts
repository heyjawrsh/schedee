import type { Account } from "@schedee/core";
import { demoSeed } from "../demo";
import type { LocalStore } from "../store/db";
import { DavError, type DavRequest } from "./caldav/dav";
import { flushCalDavAccount } from "./caldav/outbox";
import { discover, syncCalDavAccount } from "./caldav/sync";
import { refreshFeeds } from "./feeds";
import { GoogleAuthError, signInWithGoogle } from "./google/auth";
import {
	desktopCalDavForget,
	desktopCalDavSave,
	desktopDav,
	desktopForget,
	desktopSignIn,
	isDesktop,
} from "./google/desktop";
import { flushGoogleAccount, problemFor } from "./google/outbox";
import { GoogleApiError, syncGoogleAccount } from "./google/sync";

/** The auth Worker. Override with VITE_AUTH_URL; defaults to `wrangler dev`. */
export const AUTH_URL: string =
	import.meta.env.VITE_AUTH_URL ?? "http://localhost:8787";

/** How often synced accounts pull changes while the app is open. */
export const SYNC_EVERY_MS = 5 * 60_000;

const DEMO_ACCOUNTS = new Set(demoSeed().accounts.map((a) => a.id));

/** The demo calendars are only there until a real account or feed arrives. */
export async function dropDemo(store: LocalStore): Promise<void> {
	for (const a of await store.db.accounts.toArray())
		if (!a.provider && DEMO_ACCOUNTS.has(a.id)) await store.removeAccount(a.id);
}

/**
 * Signs in to Google (a popup on the web, the system browser on desktop), stores the tokens,
 * drops the demo calendars, then syncs. Signing in to an account that's already here just
 * replaces its tokens.
 */
export async function addGoogleAccount(
	store: LocalStore,
	/** Preselects this email on Google's screen, for signing in again. */
	loginHint?: string,
): Promise<Account> {
	const desktop = isDesktop();
	const tokens = desktop
		? await desktopSignIn(loginHint)
		: await signInWithGoogle(AUTH_URL, loginHint);
	if (!tokens.email) throw new GoogleAuthError("no_email");
	if (!desktop && !tokens.refreshToken)
		throw new GoogleAuthError("no_refresh_token");
	const account = {
		id: `google:${tokens.email}`,
		label: tokens.email,
		calendars: [],
		provider: "google" as const,
	};
	await store.putCredential({
		accountId: account.id,
		...(desktop
			? { keychain: true as const }
			: tokens.refreshToken
				? { refreshToken: tokens.refreshToken }
				: {}),
		accessToken: tokens.accessToken,
		expiresAt: tokens.expiresAt,
	});
	await dropDemo(store);
	const existing = await store.db.accounts.toArray();
	// A known account keeps its calendars and events; the sync below brings them up to date.
	if (!existing.some((a) => a.id === account.id))
		await store.upsertAccount(account);
	await syncAll(store);
	return account;
}

/** Signs an account in again after its sign-in expired, with its email preselected. */
export async function reconnectGoogleAccount(
	store: LocalStore,
	accountId: string,
): Promise<void> {
	const a = await store.db.accounts.get(accountId);
	await addGoogleAccount(store, a?.label);
}

export interface CalDavLogin {
	server: string;
	username: string;
	password: string;
}

/** Requests for one CalDAV account, sent from Rust with its keychain login. */
const davFor =
	(accountId: string): DavRequest =>
	(method, url, options) =>
		desktopDav(accountId, method, url, options);

/**
 * Adds an iCloud or other CalDAV account (desktop only). The login goes to the keychain and is
 * checked before anything else changes: resolves false when the server turns it down, so the
 * user can try again. Adding an account that's already here just replaces its login.
 */
export async function addCalDavAccount(
	store: LocalStore,
	login: CalDavLogin,
): Promise<boolean> {
	const host = new URL(login.server).host;
	const username = login.username.trim();
	const id = `caldav:${username}@${host}`;
	const existing = await store.db.accounts.get(id);
	await desktopCalDavSave(id, { ...login, username });
	let found: Awaited<ReturnType<typeof discover>>;
	try {
		found = await discover(davFor(id), login.server);
	} catch (e) {
		if (!existing)
			await desktopCalDavForget(id).catch(() => {
				// Nothing more to do; the next try overwrites it.
			});
		if (e instanceof DavError && e.status === 401) return false;
		throw e;
	}
	await store.putCredential({
		accountId: id,
		keychain: true,
		server: login.server,
		...found,
	});
	await dropDemo(store);
	if (existing) await store.setAccountProblem(id, undefined);
	else
		await store.upsertAccount({
			id,
			label: username.includes("@") ? username : `${username}@${host}`,
			provider: "caldav",
			calendars: [],
		});
	void syncAll(store);
	return true;
}

/** Signs a CalDAV account in again with a new password. */
export async function reconnectCalDavAccount(
	store: LocalStore,
	accountId: string,
	password: string,
): Promise<boolean> {
	const cred = await store.getCredential(accountId);
	const at = accountId.lastIndexOf("@");
	const username = accountId.slice("caldav:".length, at);
	const server = cred?.server ?? `https://${accountId.slice(at + 1)}/`;
	return addCalDavAccount(store, { server, username, password });
}

/**
 * Removes a synced account from this device: its calendars, events, unsent edits, tokens and, on
 * desktop, its keychain entry. Nothing changes on the provider. With no accounts left, the demo
 * calendars come back. A sync still running for it finds the account gone and writes nothing.
 */
export async function removeAccount(
	store: LocalStore,
	accountId: string,
): Promise<void> {
	const cred = await store.getCredential(accountId);
	const provider = (await store.db.accounts.get(accountId))?.provider;
	await store.removeAccount(accountId);
	if (cred?.keychain)
		await (provider === "caldav" ? desktopCalDavForget : desktopForget)(
			accountId,
		).catch((e: unknown) =>
			console.warn("Couldn't clear the keychain entry:", e),
		);
	if ((await store.db.accounts.count()) === 0) await store.reseed();
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Sends each synced account's queued writes, then pulls its changes. One failing account doesn't
 * stop the others. Calls that land mid-run fold into one more run after it.
 */
export function syncAll(store: LocalStore): Promise<void> {
	if (running) {
		again = true;
		return running;
	}
	running = (async () => {
		do {
			again = false;
			await syncOnce(store);
		} while (again);
	})().finally(() => {
		running = null;
	});
	return running;
}

async function syncOnce(store: LocalStore): Promise<void> {
	const accounts = await store.db.accounts.toArray();
	await Promise.all([
		refreshFeeds(store).catch((e: unknown) =>
			console.warn("Refreshing feeds failed:", e),
		),
		...accounts
			.filter((a) => a.provider === "google")
			.map(async (a) => {
				try {
					const sent = await flushGoogleAccount(store, a.id, AUTH_URL);
					if (sent.stopped === "offline") return;
					await syncGoogleAccount(store, a, AUTH_URL);
					if (a.problem) await store.setAccountProblem(a.id, undefined);
				} catch (e: unknown) {
					const problem = problemFor(e);
					if (problem) await store.setAccountProblem(a.id, problem);
					const why =
						e instanceof GoogleAuthError
							? e.code
							: e instanceof GoogleApiError
								? `HTTP ${e.status}`
								: String(e);
					console.warn(`Sync failed for ${a.label}: ${why}`);
				}
			}),
		...accounts
			.filter((a) => a.provider === "caldav" && isDesktop())
			.map(async (a) => {
				try {
					const dav = davFor(a.id);
					const sent = await flushCalDavAccount(store, a.id, dav, zone());
					if (sent.stopped === "offline") return;
					await syncCalDavAccount(store, a, dav, zone());
					if (a.problem) await store.setAccountProblem(a.id, undefined);
				} catch (e: unknown) {
					const problem = calDavProblem(e);
					if (problem) await store.setAccountProblem(a.id, problem);
					const why = e instanceof DavError ? `HTTP ${e.status}` : String(e);
					console.warn(`Sync failed for ${a.label}: ${why}`);
				}
			}),
	]);
}

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Offline is nothing to flag; a turned-down login means signing in again. */
function calDavProblem(e: unknown): Account["problem"] {
	if (e instanceof TypeError) return undefined;
	if (e instanceof DavError && e.status === 401) return "signed_out";
	if (e instanceof GoogleAuthError && e.code === "not_signed_in")
		return "signed_out";
	return "sync_failed";
}
