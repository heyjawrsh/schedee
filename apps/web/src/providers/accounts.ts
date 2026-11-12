import type { Account } from "@schedee/core";
import { demoSeed } from "../demo";
import type { LocalStore } from "../store/db";
import { GoogleAuthError, signInWithGoogle } from "./google/auth";
import { desktopSignIn, isDesktop } from "./google/desktop";
import { flushGoogleAccount } from "./google/outbox";
import { GoogleApiError, syncGoogleAccount } from "./google/sync";

/** The auth Worker. Override with VITE_AUTH_URL; defaults to `wrangler dev`. */
export const AUTH_URL: string =
	import.meta.env.VITE_AUTH_URL ?? "http://localhost:8787";

/** How often synced accounts pull changes while the app is open. */
export const SYNC_EVERY_MS = 5 * 60_000;

const DEMO_ACCOUNTS = new Set(demoSeed().accounts.map((a) => a.id));

/**
 * Signs in to Google (a popup on the web, the system browser on desktop), stores the tokens,
 * drops the demo calendars, then syncs.
 */
export async function addGoogleAccount(store: LocalStore): Promise<Account> {
	const desktop = isDesktop();
	const tokens = desktop
		? await desktopSignIn()
		: await signInWithGoogle(AUTH_URL);
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
	// The demo calendars are only there until a real account arrives.
	const existing = await store.db.accounts.toArray();
	for (const a of existing)
		if (!a.provider && DEMO_ACCOUNTS.has(a.id)) await store.removeAccount(a.id);
	await store.upsertAccount(account);
	await syncGoogleAccount(store, account, AUTH_URL);
	return account;
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
	await Promise.all(
		accounts
			.filter((a) => a.provider === "google")
			.map(async (a) => {
				try {
					const sent = await flushGoogleAccount(store, a.id, AUTH_URL);
					if (sent.stopped === "offline") return;
					await syncGoogleAccount(store, a, AUTH_URL);
				} catch (e: unknown) {
					const why =
						e instanceof GoogleAuthError
							? e.code
							: e instanceof GoogleApiError
								? `HTTP ${e.status}`
								: String(e);
					console.warn(`Sync failed for ${a.label}: ${why}`);
				}
			}),
	);
}
