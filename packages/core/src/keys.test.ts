import { describe, expect, it } from "vitest";
import { parseKeys } from "./keys";

describe("parseKeys", () => {
	it("reads words, symbols and any order of modifiers", () => {
		const s = { accelerator: "Control+Alt+Super+S", label: "⌃⌥⌘S" };
		expect(parseKeys("Ctrl+Option+Cmd+S")).toEqual(s);
		expect(parseKeys("cmd alt control s")).toEqual(s);
		expect(parseKeys("⌃⌥⌘S")).toEqual(s);
		expect(parseKeys("shift+cmd+space")).toEqual({
			accelerator: "Shift+Super+Space",
			label: "⇧⌘Space",
		});
		expect(parseKeys("ctrl+f5")?.accelerator).toBe("Control+F5");
	});

	it("turns down keys that would get in the way of typing", () => {
		expect(parseKeys("s")).toBeNull();
		expect(parseKeys("shift+s")).toBeNull();
		expect(parseKeys("ctrl+banana")).toBeNull();
		expect(parseKeys("hyper+s")).toBeNull();
		expect(parseKeys("")).toBeNull();
	});
});
