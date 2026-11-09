import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { initialView, setView, step, visibleDays } from "./navigation";

const d = (s: string) => Temporal.PlainDate.from(s);
const today = d("2026-11-12"); // Thursday

describe("navigation", () => {
	it("starts on the week containing today", () => {
		const days = visibleDays(initialView(today));
		expect(days.map(String)).toEqual([
			"2026-11-09",
			"2026-11-10",
			"2026-11-11",
			"2026-11-12",
			"2026-11-13",
			"2026-11-14",
			"2026-11-15",
		]);
	});

	it("steps by the view's period", () => {
		const w = initialView(today);
		expect(visibleDays(step(w, 1))[0]?.toString()).toBe("2026-11-16");
		const three = setView(w, "days", 3);
		expect(visibleDays(three).map(String)).toEqual([
			"2026-11-12",
			"2026-11-13",
			"2026-11-14",
		]);
		expect(visibleDays(step(three, -1))[0]?.toString()).toBe("2026-11-09");
		const day = setView(w, "day");
		expect(visibleDays(step(day, 1)).map(String)).toEqual(["2026-11-13"]);
	});

	it("normalizes 1 and 7 day counts to day and week", () => {
		expect(setView(initialView(today), "days", 7).kind).toBe("week");
		expect(setView(initialView(today), "days", 1).kind).toBe("day");
		expect(setView(initialView(today), "days", 12).count).toBe(9);
	});

	it("builds a 6-week month grid starting on the week start", () => {
		const m = setView(initialView(today), "month");
		const days = visibleDays(m);
		expect(days).toHaveLength(42);
		expect(days[0]?.toString()).toBe("2026-10-26");
		expect(days[41]?.toString()).toBe("2026-12-06");
		expect(visibleDays(step(m, 1))[0]?.toString()).toBe("2026-11-30");
	});
});
