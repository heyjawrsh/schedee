/**
 * Google sign-in inside the desktop shell. Rust runs the loopback flow and keeps the refresh
 * token in the OS keychain; this side only ever sees access tokens.
 */
import { invoke } from "@tauri-apps/api/core";
import { GoogleAuthError, type GoogleTokens } from "./auth";

declare global {
	interface Window {
		__TAURI_INTERNALS__?: unknown;
	}
}

/** True inside the Tauri webview. */
export const isDesktop = () =>
	typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const call = async <T>(cmd: string, args?: Record<string, unknown>) => {
	try {
		return await invoke<T>(cmd, args);
	} catch (e) {
		const code = typeof e === "string" ? e : String(e);
		// No network: fail the way fetch does, so callers treat it as offline.
		if (code.startsWith("network:")) throw new TypeError(code);
		throw new GoogleAuthError(code);
	}
};

/** Opens Google in the system browser and resolves once the user is back with an account. */
export const desktopSignIn = (loginHint?: string) =>
	call<GoogleTokens>("google_sign_in", { loginHint: loginHint ?? null });

/** A new access token from the keychain's refresh token. */
export const desktopRefresh = (accountId: string) =>
	call<GoogleTokens>("google_refresh", { accountId });

/** Drops an account's refresh token from the keychain. */
export const desktopForget = (accountId: string) =>
	call<void>("google_forget", { accountId });

/** What a feed fetch brings back; 304 has no body. */
export interface FeedResponse {
	status: number;
	body?: string;
	etag?: string;
	lastModified?: string;
}

/** Fetches an ICS feed from Rust, where CORS doesn't apply. */
export const desktopFetchFeed = (
	url: string,
	etag?: string,
	lastModified?: string,
) =>
	call<FeedResponse>("fetch_feed", {
		url,
		etag: etag ?? null,
		lastModified: lastModified ?? null,
	});

/** What a WebDAV request through Rust brings back. */
export interface DavResponse {
	status: number;
	body: string;
	/** Where it ended up after redirects. */
	url: string;
}

/** Saves a CalDAV login to the keychain; the password never comes back out. */
export const desktopCalDavSave = (
	accountId: string,
	login: { server: string; username: string; password: string },
) => call<void>("caldav_save", { accountId, ...login });

/** Drops a CalDAV login from the keychain. */
export const desktopCalDavForget = (accountId: string) =>
	call<void>("caldav_forget", { accountId });

/** One WebDAV request, sent from Rust with the account's login. */
export const desktopDav = (
	accountId: string,
	method: "PROPFIND" | "REPORT" | "GET",
	url: string,
	depth?: "0" | "1",
	body?: string,
) =>
	call<DavResponse>("caldav_request", {
		accountId,
		method,
		url,
		depth: depth ?? null,
		body: body ?? null,
	});
