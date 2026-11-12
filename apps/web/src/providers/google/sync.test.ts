import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalStore, SchedeeDB } from "../../store/db";
import { googleFetcher } from "./sync";

const desktop = vi.hoisted(() => ({ desktopRefresh: vi.fn() }));
vi.mock("./desktop", () => desktop);

let n = 0;
const store = () =>
	createLocalStore(
		() => ({ accounts: [], events: [] }),
		new SchedeeDB(`sync-${++n}`),
	);
const ok = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
	vi.unstubAllGlobals();
	desktop.desktopRefresh.mockReset();
});

describe("googleFetcher", () => {
	it("asks the keychain for a new token on desktop and stores no refresh token", async () => {
		const s = store();
		await s.putCredential({
			accountId: "google:ada@example.com",
			keychain: true,
			accessToken: "old",
			expiresAt: 0,
		});
		desktop.desktopRefresh.mockResolvedValue({
			accessToken: "new",
			expiresAt: Date.now() + 3_600_000,
		});
		const fetch = vi.fn(async () => ok({ items: [] }));
		vi.stubGlobal("fetch", fetch);

		await googleFetcher(s, "google:ada@example.com", "http://auth")("/x");

		expect(desktop.desktopRefresh).toHaveBeenCalledWith(
			"google:ada@example.com",
		);
		expect(fetch).toHaveBeenCalledOnce();
		const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
			.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer new");
		const cred = await s.getCredential("google:ada@example.com");
		expect(cred).toMatchObject({ keychain: true, accessToken: "new" });
		expect(cred?.refreshToken).toBeUndefined();
	});
});
