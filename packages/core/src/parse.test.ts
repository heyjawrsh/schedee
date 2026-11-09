import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { formatDuration, parseDate, parseTime } from "./parse";

describe("parseTime", () => {
	it.each([
		["9", 540],
		["9:30", 570],
		["930", 570],
		["9pm", 1260],
		["9:30 PM", 1290],
		["12am", 0],
		["12pm", 720],
		["21:30", 1290],
		["noon", 720],
		["midnight", 0],
		["9.30am", 570],
	])("%s", (input, expected) => expect(parseTime(input)).toBe(expected));

	it.each(["", "25", "13pm", "9:75", "abc"])("rejects %s", (input) =>
		expect(parseTime(input)).toBeNull(),
	);
});

describe("parseDate", () => {
	const today = Temporal.PlainDate.from("2026-11-09");
	it.each([
		["2026-11-14", "2026-11-14"],
		["11/14", "2026-11-14"],
		["11/14/27", "2027-11-14"],
		["Nov 14", "2026-11-14"],
		["14 Nov", "2026-11-14"],
		["Sat Nov 14", "2026-11-14"],
		["Saturday, November 14, 2026", "2026-11-14"],
		["Jan 3", "2027-01-03"],
		["today", "2026-11-09"],
		["tomorrow", "2026-11-10"],
	])("%s", (input, expected) =>
		expect(parseDate(input, today)?.toString()).toBe(expected),
	);

	it.each(["Feb 30", "13/1", "someday"])("rejects %s", (input) =>
		expect(parseDate(input, today)).toBeNull(),
	);
});

describe("formatDuration", () => {
	it("matches the reference style", () => {
		expect(formatDuration(90)).toBe("1\u200Ah 30\u200Amin");
		expect(formatDuration(15)).toBe("15\u200Amin");
		expect(formatDuration(120)).toBe("2\u200Ah");
	});
});
