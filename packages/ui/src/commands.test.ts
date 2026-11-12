import { initialView, Temporal, type ViewState } from "@schedee/core";
import { describe, expect, it } from "vitest";
import { buildCommands } from "./commands";

const today = Temporal.PlainDate.from("2026-11-11");
const setup = (over: Partial<Parameters<typeof buildCommands>[0]> = {}) => {
	let view: ViewState = initialView(today);
	const groups = buildCommands({
		view,
		today,
		setView: (f) => {
			view = f(view);
		},
		calendars: [
			{ id: "a", name: "Work", color: "#000" },
			{ id: "b", name: "Gym", color: "#000", hidden: true },
		],
		...over,
	});
	const item = (id: string) => {
		const found = groups.flatMap((g) => g.items).find((i) => i.id === id);
		if (!found) throw new Error(`no command ${id}`);
		return found;
	};
	return { groups, item, view: () => view };
};

describe("command list", () => {
	it("offers to sign signed-out accounts in again, first", () => {
		const ids: string[] = [];
		const { groups, item } = setup({
			signedOut: [{ id: "google:ada@example.com", label: "ada@example.com" }],
			onReconnect: (id) => ids.push(id),
			onAddAccount: () => {},
		});
		const accounts = groups.find((g) => g.label === "Accounts");
		expect(accounts?.items.map((i) => i.label)).toEqual([
			"Sign in again: ada@example.com",
			"Add Google Calendar account",
		]);
		item("reconnect-google:ada@example.com").run?.();
		expect(ids).toEqual(["google:ada@example.com"]);
	});

	it("only offers what can be done", () => {
		const labels = setup().groups.map((g) => g.label);
		expect(labels).toEqual(["Navigation", "View"]);
		const full = setup({
			createEvent: () => {},
			onTheme: () => {},
			onCalendarVisibility: () => {},
		}).groups.map((g) => g.label);
		expect(full).toEqual([
			"Calendar",
			"Navigation",
			"App",
			"Calendars",
			"View",
		]);
	});

	it("names the step after the view and leaves out the current view", () => {
		const { groups, item } = setup();
		expect(item("next").label).toBe("Go to next week");
		const view = groups.find((g) => g.label === "View")?.items.map((i) => i.id);
		expect(view).toEqual(["view-day", "view-month", "view-days"]);
	});

	it("goes to a typed date and rejects nonsense", () => {
		const { item, view } = setup();
		const prompt = item("goto-date").prompt;
		expect(prompt?.submit("not a date")).toBe(false);
		expect(prompt?.submit("12/25")).toBe(true);
		expect(view().anchor.toString()).toBe("2026-12-25");
	});

	it("offers to show hidden calendars and hide visible ones", () => {
		const calls: [string, boolean][] = [];
		const { item } = setup({
			onCalendarVisibility: (id, hidden) => calls.push([id, hidden]),
		});
		expect(item("cal-a").label).toBe("Hide “Work” calendar");
		expect(item("cal-b").label).toBe("Show “Gym” calendar");
		item("cal-b").run?.();
		expect(calls).toEqual([["b", false]]);
	});
});
