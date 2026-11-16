/**
 * The small slice of WebDAV and CalDAV that sync needs: request bodies, and a reader for the
 * multistatus answers. Requests go out through a `DavRequest`, which on desktop is Rust adding
 * the account's login.
 */
import type { DavMethod, DavOptions, DavResponse } from "../google/desktop";

export const NS = {
	dav: "DAV:",
	cal: "urn:ietf:params:xml:ns:caldav",
	cs: "http://calendarserver.org/ns/",
	apple: "http://apple.com/ns/ical/",
} as const;

export type DavRequest = (
	method: DavMethod,
	url: string,
	options?: DavOptions,
) => Promise<DavResponse>;

export class DavError extends Error {
	constructor(readonly status: number) {
		super(`CalDAV request failed: HTTP ${status}`);
	}
}

const XMLNS = `xmlns:d="${NS.dav}" xmlns:c="${NS.cal}" xmlns:cs="${NS.cs}" xmlns:x="${NS.apple}"`;
const HEAD = '<?xml version="1.0" encoding="utf-8"?>';

const escapeXml = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const propfindBody = (props: string) =>
	`${HEAD}<d:propfind ${XMLNS}><d:prop>${props}</d:prop></d:propfind>`;

/** Every change since `token`; an empty token lists everything. */
export const syncCollectionBody = (token: string) =>
	`${HEAD}<d:sync-collection ${XMLNS}><d:sync-token>${escapeXml(token)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;

/** Every event resource, for servers without sync-collection. */
export const eventQueryBody = () =>
	`${HEAD}<c:calendar-query ${XMLNS}><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`;

export const multigetBody = (hrefs: string[]) =>
	`${HEAD}<c:calendar-multiget ${XMLNS}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs
		.map((h) => `<d:href>${escapeXml(new URL(h).pathname)}</d:href>`)
		.join("")}</c:calendar-multiget>`;

/** One `<response>` of a multistatus: its absolute href, its own status and its found props. */
export interface DavItem {
	href: string;
	/** Set when the response has a status of its own (404 for a removed member). */
	status?: number;
	/** Props that came back 200. */
	props: Element[];
}

const kids = (el: Element, ns: string, name: string) =>
	Array.from(el.children).filter(
		(c) => c.namespaceURI === ns && c.localName === name,
	);
const kid = (el: Element, ns: string, name: string) => kids(el, ns, name)[0];
const code = (status: string | null | undefined) =>
	Number(status?.trim().split(/\s+/)[1] ?? 0);

export function prop(
	item: DavItem,
	ns: string,
	name: string,
): Element | undefined {
	return item.props.find((p) => p.namespaceURI === ns && p.localName === name);
}

/** The text of a prop's `<href>` child, made absolute. */
export function hrefIn(el: Element | undefined, base: string) {
	const h = el && kid(el, NS.dav, "href")?.textContent?.trim();
	return h ? new URL(h, base).toString() : undefined;
}

export function parseMultistatus(
	xml: string,
	base: string,
): { items: DavItem[]; syncToken?: string } {
	const doc = new DOMParser().parseFromString(xml, "application/xml");
	const root = doc.documentElement;
	if (root.namespaceURI !== NS.dav || root.localName !== "multistatus")
		throw new DavError(0);
	const items = kids(root, NS.dav, "response").flatMap((r): DavItem[] => {
		const href = kid(r, NS.dav, "href")?.textContent?.trim();
		if (!href) return [];
		const own = kid(r, NS.dav, "status");
		const props = kids(r, NS.dav, "propstat")
			.filter((ps) => code(kid(ps, NS.dav, "status")?.textContent) === 200)
			.flatMap((ps) => {
				const p = kid(ps, NS.dav, "prop");
				return p ? Array.from(p.children) : [];
			});
		return [
			{
				href: new URL(href, base).toString(),
				...(own ? { status: code(own.textContent) } : {}),
				props,
			},
		];
	});
	const token = kid(root, NS.dav, "sync-token")?.textContent?.trim();
	return { items, ...(token ? { syncToken: token } : {}) };
}

/** Sends a PROPFIND or REPORT and reads the multistatus, or throws the HTTP status. */
export async function multistatus(
	dav: DavRequest,
	method: "PROPFIND" | "REPORT",
	url: string,
	depth: "0" | "1" | undefined,
	body: string,
) {
	const res = await dav(method, url, { ...(depth ? { depth } : {}), body });
	if (res.status !== 207) throw new DavError(res.status);
	return parseMultistatus(res.body, res.url);
}
