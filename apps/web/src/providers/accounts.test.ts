import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalStore, SchedeeDB } from "../store/db";
import { removeAccount } from "./accounts";

const desktop = vi.hoisted(() => ({
	desktopForget: vi.fn(async () => {}),
	desktopSignIn: vi.fn(),
	desktopRefresh: vi.fn(),
	isDesktop: () => false,
}));
vi.mock("./google/desktop", () => desktop);

const seedAccount = { id: "demo", label: "Demo", calendars: [] };
let n = 0;
const store = () =>
	createLocalStore(
		() => ({ accounts: [seedAccount], events: [] }),
		new SchedeeDB(`accounts-${++n}`),
	);
const google = (email: string) => ({
	id: `google:${email}`,
	label: email,
	calendars: [{ id: `google:${email}/primary`, name: email, color: "#000" }],
	provider: "google" as const,
});

afterEach(() => desktop.desktopForget.mockClear());

describe("removeAccount", () => {
	it("clears the keychain entry and brings the demo back when nothing is left", async () => {
		const s = store();
		await s.ready;
		await s.removeAccount("demo");
		await s.upsertAccount(google("ada@example.com"));
		await s.putCredential({
			accountId: "google:ada@example.com",
			keychain: true,
		});

		await removeAccount(s, "google:ada@example.com");

		expect(desktop.desktopForget).toHaveBeenCalledWith(
			"google:ada@example.com",
		);
		expect(await s.getCredential("google:ada@example.com")).toBeUndefined();
		expect((await s.db.accounts.toArray()).map((a) => a.id)).toEqual(["demo"]);
	});

	it("leaves other accounts alone and the keychain untouched on the web", async () => {
		const s = store();
		await s.ready;
		await s.removeAccount("demo");
		await s.upsertAccount(google("ada@example.com"));
		await s.upsertAccount(google("bo@example.com"));
		await s.putCredential({
			accountId: "google:ada@example.com",
			refreshToken: "r",
		});

		await removeAccount(s, "google:ada@example.com");

		expect(desktop.desktopForget).not.toHaveBeenCalled();
		expect((await s.db.accounts.toArray()).map((a) => a.id)).toEqual([
			"google:bo@example.com",
		]);
	});
});
