/**
 * Fetches an ICS feed for the web build, since almost no feed sends CORS headers. GET only, to
 * public hosts only, with a size cap and a timeout. Feed links often carry a secret, so the URL
 * and the body are never logged or kept.
 */

export const FEED_MAX_BYTES = 10 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

export type FeedResult =
	| { status: 200; body: string; etag?: string; lastModified?: string }
	| { status: 304 }
	| {
			error:
				| "bad_url"
				| "not_allowed"
				| "unreachable"
				| "too_large"
				| "upstream";
			status?: number;
	  };

const PRIVATE_SUFFIXES = [
	".localhost",
	".local",
	".internal",
	".lan",
	".home.arpa",
	".intranet",
];

/** Only public web hosts: no IP literals, no local names. */
export function allowedFeedUrl(raw: string): URL | null {
	let u: URL;
	try {
		u = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
	} catch {
		return null;
	}
	if (u.protocol !== "https:" && u.protocol !== "http:") return null;
	if (u.username || u.password) return null;
	const host = u.hostname.toLowerCase().replace(/\.$/, "");
	if (!host.includes(".") || host === "localhost") return null;
	if (PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return null;
	// IPv6 literals come bracketed; IPv4 literals are all digits and dots.
	if (host.startsWith("[") || /^[\d.]+$/.test(host)) return null;
	return u;
}

async function readCapped(res: Response): Promise<string | null> {
	const declared = Number(res.headers.get("Content-Length") ?? 0);
	if (declared > FEED_MAX_BYTES) return null;
	const reader = res.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > FEED_MAX_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const all = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		all.set(c, at);
		at += c.byteLength;
	}
	return new TextDecoder().decode(all);
}

export async function fetchFeed(input: {
	url: unknown;
	etag?: unknown;
	lastModified?: unknown;
}): Promise<FeedResult> {
	if (typeof input.url !== "string") return { error: "bad_url" };
	const first = allowedFeedUrl(input.url);
	if (!first) return { error: "not_allowed" };
	let url: URL = first;
	const headers: Record<string, string> = {
		Accept: "text/calendar, */*;q=0.5",
		"User-Agent": "Schedee (+https://github.com/heyjawrsh/schedee)",
	};
	if (typeof input.etag === "string") headers["If-None-Match"] = input.etag;
	if (typeof input.lastModified === "string")
		headers["If-Modified-Since"] = input.lastModified;
	const signal = AbortSignal.timeout(FEED_TIMEOUT_MS);
	try {
		for (let hop = 0; ; hop++) {
			const res = await fetch(url.toString(), {
				headers,
				redirect: "manual",
				signal,
			});
			if (res.status >= 300 && res.status < 400 && res.status !== 304) {
				const to = res.headers.get("Location");
				const next: URL | null = to
					? allowedFeedUrl(new URL(to, url).toString())
					: null;
				if (!next || hop >= MAX_REDIRECTS) return { error: "not_allowed" };
				url = next;
				continue;
			}
			if (res.status === 304) return { status: 304 };
			if (!res.ok) return { error: "upstream", status: res.status };
			const body = await readCapped(res);
			if (body === null) return { error: "too_large" };
			const etag = res.headers.get("ETag");
			const lastModified = res.headers.get("Last-Modified");
			return {
				status: 200,
				body,
				...(etag ? { etag } : {}),
				...(lastModified ? { lastModified } : {}),
			};
		}
	} catch {
		return { error: "unreachable" };
	}
}
