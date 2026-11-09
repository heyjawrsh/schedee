import { describe, expect, it } from "vitest";
import { __test, chipColors } from "./chipColors";

const channelDistance = (a: string, b: string) => {
	const p = (h: string) =>
		[1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
	const [x, y] = [p(a), p(b)];
	return Math.max(...x.map((v, i) => Math.abs(v - (y[i] ?? 0))));
};

describe("chipColors", () => {
	it("round-trips OKLCH", () => {
		for (const hex of ["#757AFF", "#00FBFE", "#FF08FF", "#48CA80", "#808080"]) {
			const [L, C, h] = __test.hexToOklch(hex);
			expect(__test.oklchToHex(L, C, h)).toBe(hex);
		}
	});

	it("uses measured values for known hues", () => {
		expect(chipColors("#757aff", "#7D85FF", "light")).toEqual({
			bar: "#757AFF",
			bg: "#EFF2FF",
			title: "#504BD9",
			time: "#5C61CF",
		});
		expect(chipColors("#757AFF", "#7D85FF", "dark").bg).toBe("#3C4062");
	});

	it("derives unknown hues close to the measured ones (background model)", () => {
		// Pretend violet's measured background is unknown and compare the model against a hue we did measure.
		const modelled = chipColors("#757AFE", undefined, "light").bg; // off-table neighbour of #757AFF
		expect(channelDistance(modelled, "#EFF2FF")).toBeLessThanOrEqual(4);
	});

	it("fills missing time colors from the model", () => {
		expect(chipColors("#48CA80", "#63D18D", "light").time).toMatch(
			/^#[0-9A-F]{6}$/,
		);
	});
});
