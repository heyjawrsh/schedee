import type { Temporal } from "temporal-polyfill";

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_DAY = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
];
const ord = (n: number) =>
	`${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

const parts = (rrule: string) =>
	Object.fromEntries(
		rrule
			.split(";")
			.map((kv) => kv.split("="))
			.filter((p) => p.length === 2)
			.map(([k, v]) => [k?.toUpperCase(), v]),
	) as Record<string, string | undefined>;

/** Main label and detail for a rule, like "Every week" + "on Tue, Thu". */
export function describeRule(rrule: string): [string, string] {
	const p = parts(rrule);
	const n = Number(p.INTERVAL ?? 1);
	const every = (unit: string) =>
		n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
	const days = (p.BYDAY ?? "").split(",").filter(Boolean);
	const tail = p.COUNT
		? `, ${p.COUNT} times`
		: p.UNTIL
			? `, until ${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}`
			: "";
	switch (p.FREQ) {
		case "DAILY":
			return [every("day"), tail.slice(2)];
		case "WEEKLY": {
			if (days.join() === "MO,TU,WE,TH,FR" && n === 1)
				return ["Every weekday", tail.slice(2)];
			const names = days
				.map((d) => DAY_NAMES[DAY_CODES.indexOf(d)])
				.filter(Boolean);
			return [
				every("week"),
				`${names.length ? `on ${names.join(", ")}` : ""}${tail}`,
			];
		}
		case "MONTHLY":
			return [
				every("month"),
				p.BYMONTHDAY
					? `on the ${ord(Number(p.BYMONTHDAY))}${tail}`
					: tail.slice(2),
			];
		case "YEARLY":
			return [every("year"), tail.slice(2)];
		default:
			return ["Custom", rrule];
	}
}

export interface RulePreset {
	label: string;
	/** null = does not repeat. */
	rrule: string | null;
}

/** The repeat menu for an event starting on `date`. */
export function rulePresets(date: Temporal.PlainDate): RulePreset[] {
	const code = DAY_CODES[date.dayOfWeek - 1];
	return [
		{ label: "Does not repeat", rrule: null },
		{ label: "Every day", rrule: "FREQ=DAILY" },
		{ label: "Every weekday", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
		{
			label: `Every week on ${LONG_DAY[date.dayOfWeek - 1]}`,
			rrule: `FREQ=WEEKLY;BYDAY=${code}`,
		},
		{
			label: `Every month on the ${ord(date.day)}`,
			rrule: `FREQ=MONTHLY;BYMONTHDAY=${date.day}`,
		},
		{ label: "Every year", rrule: "FREQ=YEARLY" },
	];
}
