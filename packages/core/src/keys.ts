/** A key combination for a system-wide shortcut. */
export interface KeyCombo {
	/** For the OS, like "Control+Alt+Super+S". */
	accelerator: string;
	/** For people, like "⌃⌥⌘S". */
	label: string;
}

const MODS = [
	{ name: "Control", symbol: "⌃", words: ["ctrl", "control", "⌃"] },
	{ name: "Alt", symbol: "⌥", words: ["alt", "opt", "option", "⌥"] },
	{ name: "Shift", symbol: "⇧", words: ["shift", "⇧"] },
	{
		name: "Super",
		symbol: "⌘",
		words: ["cmd", "command", "super", "meta", "⌘"],
	},
] as const;

const NAMED: Record<string, [string, string]> = {
	space: ["Space", "Space"],
	enter: ["Enter", "↩"],
	return: ["Enter", "↩"],
	tab: ["Tab", "⇥"],
};

/**
 * Reads typed keys like "Ctrl+Option+Cmd+S", "ctrl alt cmd s" or "⌃⌥⌘S". Needs at least one
 * modifier besides Shift, so a plain letter can't take over typing everywhere.
 */
export function parseKeys(input: string): KeyCombo | null {
	const parts = input
		.trim()
		.toLowerCase()
		.replace(/([⌃⌥⇧⌘])/g, " $1 ")
		.split(/[\s+-]+/)
		.filter(Boolean);
	const key = parts.pop();
	if (!key) return null;
	const mods = new Set<(typeof MODS)[number]>();
	for (const p of parts) {
		const m = MODS.find((m) => (m.words as readonly string[]).includes(p));
		if (!m) return null;
		mods.add(m);
	}
	if (![...mods].some((m) => m.name !== "Shift")) return null;
	let name: string;
	let shown: string;
	if (/^[a-z0-9]$/.test(key)) name = shown = key.toUpperCase();
	else if (/^f([1-9]|1[0-9])$/.test(key)) name = shown = key.toUpperCase();
	else if (NAMED[key]) [name, shown] = NAMED[key];
	else return null;
	const ordered = MODS.filter((m) => mods.has(m));
	return {
		accelerator: [...ordered.map((m) => m.name), name].join("+"),
		label: ordered.map((m) => m.symbol).join("") + shown,
	};
}
