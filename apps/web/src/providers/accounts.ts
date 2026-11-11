import type { Account } from "@schedee/core";
import { demoSeed } from "../demo";
import type { LocalStore } from "../store/db";
import { GoogleAuthError, signInWithGoogle } from "./google/auth";
import { GoogleApiError, syncGoogleAccount } from "./google/sync";

/** The auth Worker. Override with VITE_AUTH_URL; defaults to `wrangler dev`. */
export const AUTH_URL: string =
	import.meta.env.VITE_AUTH_URL ?? "http://localhost:8787";

/** How often synced accounts pull changes while the app is open. */
export const SYNC_EVERY_MS = 5 * 60_000;

const DEMO_ACCOUNTS = new Set(demoSeed().accounts.map((a) => a.id));

/** Signs in to Google in a popup, stores the tokens, drops the demo calendars, then syncs. */
export async function addGoogleAccount(store: LocalStore): Promise<Account> {
	const tokens = await signInWithGoogle(AUTH_URL);
	if (!tokens.email) throw new GoogleAuthError("no_email");
	if (!tokens.refreshToken) throw new GoogleAuthError("no_refresh_token");
	const account = {
		id: `google:${tokens.email}`,
		label: tokens.email,
		calendars: [],
		provider: "google" as const,
	};
	await store.putCredential({
		accountId: account.id,
		refreshToken: tokens.refreshToken,
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

/** Pulls changes for every synced account. One failing account doesn't stop the others. */
export async function syncAll(store: LocalStore): Promise<void> {
	const accounts = await store.db.accounts.toArray();
	await Promise.all(
		accounts
			.filter((a) => a.provider === "google")
			.map((a) =>
				syncGoogleAccount(store, a, AUTH_URL).catch((e: unknown) => {
					const why =
						e instanceof GoogleAuthError
							? e.code
							: e instanceof GoogleApiError
								? `HTTP ${e.status}`
								: String(e);
					console.warn(`Sync failed for ${a.label}: ${why}`);
				}),
			),
	);
}
