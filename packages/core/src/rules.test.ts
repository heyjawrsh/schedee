import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { describeRule, rulePresets } from "./rules";

describe("describeRule", () => {
	it.each([
		["FREQ=WEEKLY;BYDAY=TU,TH", ["Every week", "on Tue, Thu"]],
		["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", ["Every weekday", ""]],
		["FREQ=DAILY", ["Every day", ""]],
		["FREQ=DAILY;INTERVAL=2;COUNT=5", ["Every 2 days", "5 times"]],
		["FREQ=MONTHLY;BYMONTHDAY=22", ["Every month", "on the 22nd"]],
		["FREQ=YEARLY;UNTIL=20301231T000000Z", ["Every year", "until 2030-12-31"]],
	])("%s", (rule, expected) => expect(describeRule(rule)).toEqual(expected));
});

describe("rulePresets", () => {
	it("tailors weekly and monthly options to the start date", () => {
		const labels = rulePresets(Temporal.PlainDate.from("2026-11-14")).map(
			(p) => p.label,
		);
		expect(labels).toContain("Every week on Saturday");
		expect(labels).toContain("Every month on the 14th");
	});
});
