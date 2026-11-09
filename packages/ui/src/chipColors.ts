// Event-chip colors derived from a calendar color (docs/re/tokens.md section 1.2).
// Measured values win for the hues the reference showed; other hues use the fitted OKLCH model.

export type Theme = "light" | "dark";

export interface ChipColors {
	bar: string;
	bg: string;
	title: string;
	time: string;
}

interface Measured {
	light: ChipColors & { pastTitle?: string; pastTime?: string };
	dark: ChipColors & { pastTitle?: string; pastTime?: string };
}

/** Keyed by the calendar's light color (upper-case hex). */
const MEASURED: Record<string, Measured> = {
	"#757AFF": {
		light: {
			bar: "#757AFF",
			bg: "#EFF2FF",
			title: "#504BD9",
			time: "#5C61CF",
			pastTitle: "#A3A7CB",
			pastTime: "#BBBEDA",
		},
		dark: {
			bar: "#7D85FF",
			bg: "#3C4062",
			title: "#F8FCFF",
			time: "#949AD1",
			pastTitle: "#828497",
			pastTime: "#676A84",
		},
	},
	"#00FBFE": {
		light: {
			bar: "#00FBFE",
			bg: "#D1FFFF",
			title: "#007E83",
			time: "#00878A",
			pastTitle: "#83B4B4",
		},
		dark: {
			bar: "#1FFFFF",
			bg: "#1B4B4B",
			title: "#CDFFFF",
			time: "#5CADAE",
			pastTitle: "#738B8A",
		},
	},
	"#FF08FF": {
		light: {
			bar: "#FF08FF",
			bg: "#FFDCFF",
			title: "#9C119D",
			time: "#A33BA0",
			pastTitle: "#C49ABD",
			pastTime: "#D6B3CF",
		},
		dark: {
			bar: "#FF45FF",
			bg: "#5F2C5C",
			title: "#FFEBFF",
			time: "#C287BB",
			pastTitle: "#947D8F",
			pastTime: "#7F617A",
		},
	},
	"#48CA80": {
		light: {
			bar: "#48CA80",
			bg: "#DDFFE3",
			title: "#007B28",
			time: "",
			pastTitle: "#89B594",
		},
		dark: {
			bar: "#63D18D",
			bg: "#2D4935",
			title: "#D6FFE3",
			time: "",
			pastTitle: "#768B7A",
		},
	},
	"#B3B4B4": {
		light: { bar: "#B3B4B4", bg: "#F7F4F3", title: "#5D5E5F", time: "" },
		dark: { bar: "#BDBCBC", bg: "#424242", title: "#FFFFFF", time: "" },
	},
};

// --- sRGB <-> OKLCH -------------------------------------------------------------------------

const toLinear = (c: number) =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = (c: number) =>
	c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function hexToOklch(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
		toLinear(v / 255),
	) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function oklchToHex(L: number, C: number, h: number): string {
	const A = C * Math.cos(h);
	const B = C * Math.sin(h);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	const rgb = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	return `#${rgb
		.map((c) =>
			Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")
		.toUpperCase()}`;
}

/** Fitted model (INFERRED): keep hue, fixed lightness, scaled chroma. */
function derived(
	light: string,
	dark: string,
	theme: Theme,
	past: boolean,
): ChipColors {
	const [, C, h] = hexToOklch(light);
	const f = (L: number, k: number) => oklchToHex(L, k * C, h);
	if (theme === "light")
		return past
			? {
					bar: light,
					bg: f(0.97, 0.32),
					title: f(0.73, 0.3),
					time: f(0.807, 0.19),
				}
			: {
					bar: light,
					bg: f(0.97, 0.32),
					title: f(0.5, 1.0),
					time: f(0.554, 0.64),
				};
	return past
		? {
				bar: dark,
				bg: f(0.38, 0.33),
				title: f(0.614, 0.16),
				time: f(0.532, 0.19),
			}
		: {
				bar: dark,
				bg: f(0.38, 0.33),
				title: f(0.99, 0.4),
				time: f(0.696, 0.44),
			};
}

export function chipColors(
	color: string,
	colorDark: string | undefined,
	theme: Theme,
	past = false,
): ChipColors {
	const light = color.toUpperCase();
	const dark = (colorDark ?? color).toUpperCase();
	const model = derived(light, dark, theme, past);
	const m = MEASURED[light]?.[theme];
	if (!m) return model;
	return {
		bar: m.bar,
		bg: m.bg,
		title: (past ? m.pastTitle : m.title) || model.title,
		time: (past ? m.pastTime : m.time) || model.time,
	};
}

export const __test = { hexToOklch, oklchToHex };
