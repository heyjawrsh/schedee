import { afterEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_TOKEN } from "./google";
import worker, { type Env } from "./index";

const ENV: Env = {
	GOOGLE_WEB_CLIENT_ID: "client-id.apps.googleusercontent.com",
	GOOGLE_WEB_CLIENT_SECRET: "test-secret",
	APP_ORIGIN: "http://localhost:5173",
};
const BASE = "http://localhost:8787";
const call = (path: string, init: RequestInit = {}) =>
	worker.fetch(new Request(`${BASE}${path}`, init), ENV);
const b64 = (n: number) => "a".repeat(n);

afterEach(() => vi.unstubAllGlobals());

describe("worker", () => {
	it("answers health checks and 404s everything else", async () => {
		const res = await call("/health");
		expect(await res.json()).toEqual({ ok: true });
		expect((await call("/")).status).toBe(404);
		expect((await call("/health", { method: "POST" })).status).toBe(404);
	});

	it("starts Google sign-in with PKCE, offline access and our callback", async () => {
		const res = await call(
			`/oauth/google/start?state=${b64(43)}&code_challenge=${b64(43)}`,
		);
		expect(res.status).toBe(302);
		const to = new URL(res.headers.get("Location") ?? "");
		expect(to.origin + to.pathname).toBe(
			"https://accounts.google.com/o/oauth2/v2/auth",
		);
		const p = to.searchParams;
		expect(p.get("client_id")).toBe(ENV.GOOGLE_WEB_CLIENT_ID);
		expect(p.get("redirect_uri")).toBe(`${BASE}/oauth/google/callback`);
		expect(p.get("code_challenge_method")).toBe("S256");
		expect(p.get("access_type")).toBe("offline");
		expect(p.get("scope")).toContain("calendar.events");
		expect(p.has("client_secret")).toBe(false);
	});

	it("rejects a start without a proper state or challenge", async () => {
		expect((await call("/oauth/google/start?state=x")).status).toBe(400);
	});

	it("hands the code to the opener on the app origin only", async () => {
		const res = await call(
			"/oauth/google/callback?code=4%2Fabc&state=s</script>",
		);
		const html = await res.text();
		expect(html).toContain('"code":"4/abc"');
		expect(html).toContain('"http://localhost:5173"');
		expect(html).not.toContain("s</script>");
		expect(res.headers.get("Cache-Control")).toBe("no-store");
	});

	it("refuses token calls from any other origin", async () => {
		const res = await call("/oauth/google/token", {
			method: "POST",
			headers: {
				Origin: "https://evil.example",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ code: "c", code_verifier: "v" }),
		});
		expect(res.status).toBe(403);
	});

	it("exchanges a code with the secret, the verifier and the same redirect URI", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				access_token: "at",
				refresh_token: "rt",
				expires_in: 3599,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const res = await call("/oauth/google/token", {
			method: "POST",
			headers: { Origin: ENV.APP_ORIGIN, "Content-Type": "application/json" },
			body: JSON.stringify({ code: "c0de", code_verifier: "ver" }),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ENV.APP_ORIGIN);
		expect(await res.json()).toMatchObject({ refresh_token: "rt" });
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe(GOOGLE_TOKEN);
		const form = new URLSearchParams(init.body as URLSearchParams);
		expect(Object.fromEntries(form)).toMatchObject({
			grant_type: "authorization_code",
			code: "c0de",
			code_verifier: "ver",
			client_secret: "test-secret",
			redirect_uri: `${BASE}/oauth/google/callback`,
		});
	});

	it("refreshes, and passes Google's errors through", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ error: "invalid_grant" }, { status: 400 }),
			),
		);
		const res = await call("/oauth/google/refresh", {
			method: "POST",
			headers: { Origin: ENV.APP_ORIGIN, "Content-Type": "application/json" },
			body: JSON.stringify({ refresh_token: "old" }),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "invalid_grant" });
	});

	it("answers CORS preflight for the app", async () => {
		const res = await call("/oauth/google/token", {
			method: "OPTIONS",
			headers: { Origin: ENV.APP_ORIGIN },
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
	});
});
