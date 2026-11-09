import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { weekOf } from "./week";

const d = (s: string) => Temporal.PlainDate.from(s);

describe("weekOf", () => {
	it("starts on Monday by default", () => {
		const w = weekOf(d("2026-11-12")); // Thursday
		expect(w.start.toString()).toBe("2026-11-09");
		expect(w.end.toString()).toBe("2026-11-15");
		expect(w.days).toHaveLength(7);
	});

	it("returns the same week when given the start day itself", () => {
		expect(weekOf(d("2026-11-09")).start.toString()).toBe("2026-11-09");
	});

	it("honours a Sunday week start", () => {
		const w = weekOf(d("2026-11-12"), 7);
		expect(w.start.toString()).toBe("2026-11-08");
		expect(w.end.toString()).toBe("2026-11-14");
	});

	it("crosses month and year boundaries", () => {
		const w = weekOf(d("2027-01-01")); // Friday
		expect(w.start.toString()).toBe("2026-12-28");
		expect(w.days.map((x) => x.day)).toEqual([28, 29, 30, 31, 1, 2, 3]);
	});
});
