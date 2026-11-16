import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedFeedUrl, FEED_MAX_BYTES, fetchFeed } from "./feed";
import worker, { type Env } from "./index";

const ENV: Env = {
	GOOGLE_WEB_CLIENT_ID: "id",
	GOOGLE_WEB_CLIENT_SECRET: "secret",
	APP_ORIGIN: "http://localhost:5173",
};
const ICS = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";

afterEach(() => vi.unstubAllGlobals());

describe("feed URLs", () => {
	it("allows public web hosts only", () => {
		expect(
			allowedFeedUrl("webcal://p01-calendars.icloud.com/x")?.protocol,
		).toBe("https:");
		expect(allowedFeedUrl("https://calendar.google.com/a.ics")).not.toBeNull();
		for (const bad of [
			"file:///etc/passwd",
			"ftp://example.com/a.ics",
			"http://localhost:8787/health",
			"http://127.0.0.1/a.ics",
			"http://10.0.0.5/a.ics",
			"http://[::1]/a.ics",
			"http://printer.local/a.ics",
			"http://intranet/a.ics",
			"https://user:pass@example.com/a.ics",
		])
			expect(allowedFeedUrl(bad), bad).toBeNull();
	});
});

describe("fetchFeed", () => {
	it("returns the body with its validators, and sends ours back", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(ICS, {
					headers: { ETag: '"v2"', "Last-Modified": "Wed, 11 Nov 2026" },
				}),
		);
		vi.stubGlobal("fetch", fetch);
		const r = await fetchFeed({
			url: "webcal://example.com/a.ics",
			etag: '"v1"',
		});
		expect(r).toEqual({
			status: 200,
			body: ICS,
			etag: '"v2"',
			lastModified: "Wed, 11 Nov 2026",
		});
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://example.com/a.ics");
		expect((init.headers as Record<string, string>)["If-None-Match"]).toBe(
			'"v1"',
		);
		expect(init.redirect).toBe("manual");
	});

	it("passes 304 through", async () => {
		vi.stubGlobal("fetch", async () => new Response(null, { status: 304 }));
		expect(await fetchFeed({ url: "https://example.com/a.ics" })).toEqual({
			status: 304,
		});
	});

	it("follows redirects to public hosts but not to private ones", async () => {
		const hops: Record<string, Response> = {
			"https://example.com/a.ics": new Response(null, {
				status: 301,
				headers: { Location: "https://cdn.example.com/a.ics" },
			}),
			"https://cdn.example.com/a.ics": new Response(ICS),
			"https://example.com/b.ics": new Response(null, {
				status: 302,
				headers: { Location: "http://127.0.0.1/secret" },
			}),
		};
		vi.stubGlobal("fetch", async (u: string) => hops[u]);
		expect(await fetchFeed({ url: "https://example.com/a.ics" })).toMatchObject(
			{
				status: 200,
				body: ICS,
			},
		);
		expect(await fetchFeed({ url: "https://example.com/b.ics" })).toEqual({
			error: "not_allowed",
		});
	});

	it("refuses oversized feeds and reports unreachable hosts", async () => {
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response("x", {
					headers: { "Content-Length": String(FEED_MAX_BYTES + 1) },
				}),
		);
		expect(await fetchFeed({ url: "https://example.com/a.ics" })).toEqual({
			error: "too_large",
		});
		vi.stubGlobal("fetch", async () => {
			throw new TypeError("network");
		});
		expect(await fetchFeed({ url: "https://example.com/a.ics" })).toEqual({
			error: "unreachable",
		});
	});

	it("is only open to the app", async () => {
		vi.stubGlobal("fetch", async () => new Response(ICS));
		const post = (origin: string) =>
			worker.fetch(
				new Request("http://localhost:8787/feed", {
					method: "POST",
					headers: { Origin: origin, "Content-Type": "application/json" },
					body: JSON.stringify({ url: "https://example.com/a.ics" }),
				}),
				ENV,
			);
		expect((await post("https://evil.example")).status).toBe(403);
		const ok = await post(ENV.APP_ORIGIN);
		expect(ok.status).toBe(200);
		expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ENV.APP_ORIGIN);
		expect(await ok.json()).toMatchObject({ status: 200, body: ICS });
	});
});
