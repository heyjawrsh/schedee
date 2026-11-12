/**
 * Google sign-in for the web build: authorization code with PKCE in a popup. The Worker holds
 * the client secret and swaps the code for tokens; the verifier never leaves this window until
 * that exchange.
 */

export interface GoogleTokens {
	accessToken: string;
	/** Epoch ms. */
	expiresAt: number;
	refreshToken?: string;
	/** From the ID token: the account's email and stable Google user id. */
	email?: string;
	sub?: string;
}

const b64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");

const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function pkcePair() {
	const verifier = random(32);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/** Reads the email and subject from an ID token. It came straight from Google over TLS via our Worker. */
export function idClaims(idToken: string | undefined): {
	email?: string;
	sub?: string;
} {
	const part = idToken?.split(".")[1];
	if (!part) return {};
	try {
		const json = atob(part.replaceAll("-", "+").replaceAll("_", "/"));
		const { email, sub } = JSON.parse(json) as { email?: string; sub?: string };
		return { ...(email ? { email } : {}), ...(sub ? { sub } : {}) };
	} catch {
		return {};
	}
}

interface TokenResponse {
	access_token?: string;
	expires_in?: number;
	refresh_token?: string;
	id_token?: string;
	error?: string;
	error_description?: string;
}

const toTokens = (r: TokenResponse): GoogleTokens => {
	if (!r.access_token) throw new GoogleAuthError(r.error ?? "no_token");
	return {
		accessToken: r.access_token,
		expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
		...(r.refresh_token ? { refreshToken: r.refresh_token } : {}),
		...idClaims(r.id_token),
	};
};

export class GoogleAuthError extends Error {
	constructor(readonly code: string) {
		super(`Google sign-in failed: ${code}`);
	}
}

const post = async (url: string, body: unknown): Promise<TokenResponse> => {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return (await res.json()) as TokenResponse;
};

/** Opens Google's consent screen in a popup and resolves with tokens for the chosen account. */
export async function signInWithGoogle(
	authUrl: string,
	/** Preselects this account on Google's screen. */
	loginHint?: string,
): Promise<GoogleTokens> {
	const state = random(32);
	const { verifier, challenge } = await pkcePair();
	const start = `${authUrl}/oauth/google/start?${new URLSearchParams({
		state,
		code_challenge: challenge,
		...(loginHint ? { login_hint: loginHint } : {}),
	})}`;
	const popup = window.open(
		start,
		"schedee-google",
		"popup,width=500,height=650",
	);
	if (!popup) throw new GoogleAuthError("popup_blocked");
	const authOrigin = new URL(authUrl).origin;

	const code = await new Promise<string>((resolve, reject) => {
		const timer = setInterval(() => {
			if (popup.closed) done(() => reject(new GoogleAuthError("closed")));
		}, 500);
		const onMessage = (e: MessageEvent) => {
			const m = e.data as {
				type?: string;
				state?: string;
				code?: string | null;
				error?: string | null;
			};
			if (e.origin !== authOrigin || m?.type !== "schedee:oauth") return;
			if (m.state !== state) return;
			done(() =>
				m.code
					? resolve(m.code)
					: reject(new GoogleAuthError(m.error ?? "no_code")),
			);
		};
		const done = (f: () => void) => {
			clearInterval(timer);
			removeEventListener("message", onMessage);
			f();
		};
		addEventListener("message", onMessage);
	});

	return toTokens(
		await post(`${authUrl}/oauth/google/token`, {
			code,
			code_verifier: verifier,
		}),
	);
}

/** Swaps a refresh token for a new access token. Throws `invalid_grant` when the grant is gone. */
export async function refreshGoogle(
	authUrl: string,
	refreshToken: string,
): Promise<GoogleTokens> {
	return toTokens(
		await post(`${authUrl}/oauth/google/refresh`, {
			refresh_token: refreshToken,
		}),
	);
}
