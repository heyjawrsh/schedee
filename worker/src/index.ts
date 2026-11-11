/**
 * Stateless auth helper for the web build. It turns OAuth codes into tokens and refreshes them,
 * holding the client secret the browser must not see. It stores nothing and logs no bodies.
 */
import { GOOGLE_AUTH, GOOGLE_SCOPES, GOOGLE_TOKEN } from "./google";

export interface Env {
	GOOGLE_WEB_CLIENT_ID: string;
	GOOGLE_WEB_CLIENT_SECRET: string;
	/** The app origin allowed to call the token endpoints and receive the sign-in result. */
	APP_ORIGIN: string;
}

/** PKCE challenges and state values are base64url, 43 to 128 characters. */
const B64URL = /^[A-Za-z0-9_-]{43,128}$/;

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
	Response.json(body, { status, headers });

const cors = (env: Env) => ({
	"Access-Control-Allow-Origin": env.APP_ORIGIN,
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "600",
	Vary: "Origin",
});

const redirectUri = (request: Request) =>
	`${new URL(request.url).origin}/oauth/google/callback`;

/** Sends the browser to Google's consent screen. */
function start(request: Request, env: Env): Response {
	const url = new URL(request.url);
	const state = url.searchParams.get("state") ?? "";
	const challenge = url.searchParams.get("code_challenge") ?? "";
	if (!B64URL.test(state) || !B64URL.test(challenge))
		return json({ error: "invalid_request" }, 400);
	const to = new URL(GOOGLE_AUTH);
	to.search = new URLSearchParams({
		client_id: env.GOOGLE_WEB_CLIENT_ID,
		redirect_uri: redirectUri(request),
		response_type: "code",
		scope: GOOGLE_SCOPES.join(" "),
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: "true",
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
	}).toString();
	const login = url.searchParams.get("login_hint");
	if (login) to.searchParams.set("login_hint", login);
	return Response.redirect(to.toString(), 302);
}

/** Google returns here; hand the code to the app window that opened the popup, then close. */
function callback(request: Request, env: Env): Response {
	const p = new URL(request.url).searchParams;
	const message = {
		type: "schedee:oauth",
		provider: "google",
		code: p.get("code"),
		state: p.get("state"),
		error: p.get("error"),
	};
	// Escape "<" so the payload can't close the script tag.
	const payload = JSON.stringify(message).replaceAll("<", "\\u003c");
	const origin = JSON.stringify(env.APP_ORIGIN).replaceAll("<", "\\u003c");
	const html = `<!doctype html><meta charset="utf-8"><title>Schedee</title>
<p>Signed in. You can close this window.</p>
<script>
if (window.opener) { window.opener.postMessage(${payload}, ${origin}); window.close(); }
</script>`;
	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
			"Content-Security-Policy":
				"default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
		},
	});
}

/** Forwards a token request to Google with the client credentials added. */
async function token(
	request: Request,
	env: Env,
	grant: "authorization_code" | "refresh_token",
): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: "invalid_request" }, 400, cors(env));
	}
	const form = new URLSearchParams({
		client_id: env.GOOGLE_WEB_CLIENT_ID,
		client_secret: env.GOOGLE_WEB_CLIENT_SECRET,
		grant_type: grant,
	});
	if (grant === "authorization_code") {
		const { code, code_verifier } = body;
		if (typeof code !== "string" || typeof code_verifier !== "string")
			return json({ error: "invalid_request" }, 400, cors(env));
		form.set("code", code);
		form.set("code_verifier", code_verifier);
		form.set("redirect_uri", redirectUri(request));
	} else {
		const { refresh_token } = body;
		if (typeof refresh_token !== "string")
			return json({ error: "invalid_request" }, 400, cors(env));
		form.set("refresh_token", refresh_token);
	}
	const res = await fetch(GOOGLE_TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: form,
	});
	return new Response(res.body, {
		status: res.status,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
			...cors(env),
		},
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const route = `${request.method} ${url.pathname}`;
		if (route === "GET /health") return json({ ok: true });
		if (route === "GET /oauth/google/start") return start(request, env);
		if (route === "GET /oauth/google/callback") return callback(request, env);

		const tokenRoute =
			url.pathname === "/oauth/google/token" ||
			url.pathname === "/oauth/google/refresh";
		if (tokenRoute) {
			// Only the app may spend our client credentials.
			if (request.headers.get("Origin") !== env.APP_ORIGIN)
				return json({ error: "forbidden" }, 403);
			if (request.method === "OPTIONS")
				return new Response(null, { status: 204, headers: cors(env) });
			if (request.method === "POST")
				return token(
					request,
					env,
					url.pathname.endsWith("/token")
						? "authorization_code"
						: "refresh_token",
				);
		}
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
