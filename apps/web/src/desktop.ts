/**
 * Desktop-only conveniences: opening at login and system-wide shortcuts. The chosen keys are
 * kept on this device and registered with the OS at startup.
 */
import { parseKeys } from "@schedee/core";
import type { GlobalAction } from "@schedee/ui";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const KEY = "schedee.shortcuts";
const DEFAULTS: Record<GlobalAction, string> = {
	show: "Ctrl+Option+Cmd+S",
	"new-event": "Ctrl+Option+Cmd+N",
};
const ACTIONS = Object.keys(DEFAULTS) as GlobalAction[];

/** Each shortcut's typed keys, or "" when off. */
export function savedShortcuts(): Record<GlobalAction, string> {
	try {
		const raw = localStorage.getItem(KEY);
		return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
	} catch {
		return { ...DEFAULTS };
	}
}

function save(all: Record<GlobalAction, string>) {
	try {
		localStorage.setItem(KEY, JSON.stringify(all));
	} catch {
		// Storage can be unavailable; the keys still work until the app quits.
	}
}

/** "⌃⌥⌘S", or "" when off. */
export const shortcutLabel = (keys: string) => parseKeys(keys)?.label ?? "";

/** Registers one shortcut. Resolves false when the keys can't be read or another app has them. */
async function register(action: GlobalAction, keys: string) {
	const combo = keys ? parseKeys(keys) : null;
	if (keys && !combo) return false;
	try {
		await invoke("shortcut_set", {
			action,
			keys: combo?.accelerator ?? "",
		});
		return true;
	} catch (e) {
		console.warn(`Couldn't set the shortcut to ${action}:`, e);
		return false;
	}
}

/** Registers the saved shortcuts. One that's taken stays saved and is tried again next launch. */
export async function registerShortcuts() {
	const all = savedShortcuts();
	await Promise.all(ACTIONS.map((a) => register(a, all[a])));
}

/** Changes one shortcut and remembers it if the OS takes it. */
export async function setShortcut(action: GlobalAction, keys: string) {
	if (!(await register(action, keys))) return false;
	save({ ...savedShortcuts(), [action]: keys });
	return true;
}

export const launchAtLogin = () =>
	invoke<boolean>("autostart_get").catch(() => false);
export const setLaunchAtLogin = (on: boolean) =>
	invoke("autostart_set", { on });

/** Calls back when the new-event shortcut is pressed; returns a function that stops. */
export function onNewEventShortcut(run: () => void): () => void {
	const off = listen("schedee://new-event", run);
	return () => void off.then((f) => f());
}
