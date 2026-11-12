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
		throw new GoogleAuthError(typeof e === "string" ? e : String(e));
	}
};

/** Opens Google in the system browser and resolves once the user is back with an account. */
export const desktopSignIn = () => call<GoogleTokens>("google_sign_in");

/** A new access token from the keychain's refresh token. */
export const desktopRefresh = (accountId: string) =>
	call<GoogleTokens>("google_refresh", { accountId });

/** Drops an account's refresh token from the keychain. */
export const desktopForget = (accountId: string) =>
	call<void>("google_forget", { accountId });
