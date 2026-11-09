import { Temporal } from "temporal-polyfill";

/** Parses typed times: "9", "9:30", "930", "9pm", "9:30 PM", "21:30", "noon", "midnight". Minutes since midnight. */
export function parseTime(input: string): number | null {
	const s = input.trim().toLowerCase().replace(/\s+/g, "").replaceAll(".", "");
	if (s === "noon") return 12 * 60;
	if (s === "midnight") return 0;
	const m = /^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/.exec(s);
	if (!m) return null;
	let h = Number(m[1]);
	const min = m[2] ? Number(m[2]) : 0;
	const mer = m[3]?.[0];
	if (min > 59) return null;
	if (mer) {
		if (h < 1 || h > 12) return null;
		h = (h % 12) + (mer === "p" ? 12 : 0);
	} else if (h > 23) return null;
	return h * 60 + min;
}

const MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

/**
 * Parses typed dates relative to `today`: "2026-11-14", "11/14", "11/14/27", "Nov 14", "14 Nov",
 * "Sat Nov 14", "today", "tomorrow". A date without a year picks the next occurrence on or after today.
 */
export function parseDate(
	input: string,
	today: Temporal.PlainDate,
): Temporal.PlainDate | null {
	const s = input
		.trim()
		.toLowerCase()
		.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*/, "")
		.replace(/,/g, "");
	if (s === "today") return today;
	if (s === "tomorrow") return today.add({ days: 1 });
	if (s === "yesterday") return today.subtract({ days: 1 });
	const build = (year: number | undefined, month: number, day: number) => {
		try {
			if (year !== undefined)
				return Temporal.PlainDate.from(
					{ year, month, day },
					{ overflow: "reject" },
				);
			const d = Temporal.PlainDate.from(
				{ year: today.year, month, day },
				{ overflow: "reject" },
			);
			return Temporal.PlainDate.compare(d, today) < 0 ? d.add({ years: 1 }) : d;
		} catch {
			return null;
		}
	};
	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
	if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));
	m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
	if (m)
		return build(
			m[3]
				? m[3].length === 2
					? 2000 + Number(m[3])
					: Number(m[3])
				: undefined,
			Number(m[1]),
			Number(m[2]),
		);
	m = /^([a-z]{3})[a-z]*\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(s);
	if (m) {
		const month = MONTHS.indexOf(m[1] ?? "") + 1;
		return month
			? build(m[3] ? Number(m[3]) : undefined, month, Number(m[2]))
			: null;
	}
	m = /^(\d{1,2})\s+([a-z]{3})[a-z]*(?:\s+(\d{4}))?$/.exec(s);
	if (m) {
		const month = MONTHS.indexOf(m[2] ?? "") + 1;
		return month
			? build(m[3] ? Number(m[3]) : undefined, month, Number(m[1]))
			: null;
	}
	return null;
}

/** "1h 30min", "15min", "2h" with hair spaces, like the reference. */
export function formatDuration(minutes: number): string {
	const HAIR = "\u200A";
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h && m) return `${h}${HAIR}h ${m}${HAIR}min`;
	return h ? `${h}${HAIR}h` : `${m}${HAIR}min`;
}
