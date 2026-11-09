// Time labels in the reference style: thin space before the meridiem, hair spaces around the dash.
const THIN = " ";
const HAIR = " ";

const parts = (min: number) => {
	const h24 = Math.floor(min / 60) % 24;
	const m = min % 60;
	const mer = h24 < 12 ? "AM" : "PM";
	const h = h24 % 12 === 0 ? 12 : h24 % 12;
	return {
		clock: m === 0 ? `${h}` : `${h}:${String(m).padStart(2, "0")}`,
		mer,
	};
};

/** "10:15 AM" */
export function formatTime(min: number): string {
	const p = parts(min);
	return `${p.clock}${THIN}${p.mer}`;
}

/** "8:30 – 10 AM", "11 AM – 12 PM" */
export function formatRange(startMin: number, endMin: number): string {
	const a = parts(startMin);
	const b = parts(endMin);
	return a.mer === b.mer
		? `${a.clock}${HAIR}–${HAIR}${b.clock}${THIN}${b.mer}`
		: `${a.clock}${THIN}${a.mer}${HAIR}–${HAIR}${b.clock}${THIN}${b.mer}`;
}

/** Hour label parts for the gutter: ["1", "AM"]. */
export function hourParts(hour: number): [string, string] {
	const p = parts(hour * 60);
	return [p.clock, p.mer];
}

/** Now label parts: ["1:18", "AM"]. */
export function nowParts(min: number): [string, string] {
	const h24 = Math.floor(min / 60);
	const m = Math.floor(min % 60);
	const h = h24 % 12 === 0 ? 12 : h24 % 12;
	return [`${h}:${String(m).padStart(2, "0")}`, h24 < 12 ? "AM" : "PM"];
}
