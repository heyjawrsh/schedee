import {
	type CalendarSnapshot,
	type EditResult,
	Temporal,
} from "@schedee/core";
import { Schedee, type Theme, type ThemeChoice } from "@schedee/ui";
import { useEffect, useState } from "react";
import { demoSeed } from "./demo";
import { addGoogleAccount, SYNC_EVERY_MS, syncAll } from "./providers/accounts";
import { createLocalStore, type LocalStore } from "./store/db";

declare global {
	interface Window {
		/** Injected by the fidelity harness and tests: render this static snapshot instead of the store. */
		__SCHEDEE_SNAPSHOT__?: CalendarSnapshot | null;
		__SCHEDEE_THEME__?: Theme;
		__SCHEDEE_SCROLL_TOP__?: number;
		__SCHEDEE_SELECT__?: string;
		/** For tests: resolves once every edit so far is saved. */
		__SCHEDEE_SAVED__?: () => Promise<void>;
	}
}

const systemTheme = (): Theme =>
	matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const zone = Temporal.Now.timeZoneId();
const zoneLabel =
	new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
		.formatToParts(new Date())
		.find((p) => p.type === "timeZoneName")?.value ?? zone;
const nowIso = () =>
	Temporal.Now.plainDateTimeISO().toString({ smallestUnit: "second" });

const THEME_KEY = "schedee.theme";
const readChoice = (): ThemeChoice => {
	try {
		const v = localStorage.getItem(THEME_KEY);
		return v === "light" || v === "dark" ? v : "system";
	} catch {
		return "system";
	}
};

/** The theme in effect, the saved choice, and a setter that remembers it on this device. */
function useTheme(): [Theme, ThemeChoice, (t: ThemeChoice) => void] {
	const [choice, setChoice] = useState<ThemeChoice>(readChoice);
	const [system, setSystem] = useState<Theme>(systemTheme);
	useEffect(() => {
		const mq = matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => setSystem(systemTheme());
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	const choose = (t: ThemeChoice) => {
		setChoice(t);
		try {
			if (t === "system") localStorage.removeItem(THEME_KEY);
			else localStorage.setItem(THEME_KEY, t);
		} catch {
			// Storage can be unavailable (private windows); the choice still lasts this session.
		}
	};
	const theme =
		window.__SCHEDEE_THEME__ ?? (choice === "system" ? system : choice);
	return [theme, choice, choose];
}

/** Live data: the local store, plus a clock that ticks every 30 seconds. */
function useLiveSnapshot(
	enabled: boolean,
): [CalendarSnapshot | null, LocalStore | null] {
	const [store, setStore] = useState<LocalStore | null>(null);
	const [data, setData] = useState<Pick<
		CalendarSnapshot,
		"accounts" | "events"
	> | null>(null);
	const [now, setNow] = useState(nowIso);
	useEffect(() => {
		if (!enabled) return;
		const s = createLocalStore(demoSeed);
		setStore(s);
		window.__SCHEDEE_SAVED__ = () => s.settled();
		const off = s.subscribe(setData);
		const tick = setInterval(() => setNow(nowIso()), 30_000);
		// Synced accounts: pull on start, on a timer, and when the window comes back.
		const pull = () => void s.ready.then(() => syncAll(s));
		pull();
		const timer = setInterval(pull, SYNC_EVERY_MS);
		addEventListener("focus", pull);
		// Edits made offline go out as soon as the network is back.
		addEventListener("online", pull);
		return () => {
			off();
			clearInterval(tick);
			clearInterval(timer);
			removeEventListener("focus", pull);
			removeEventListener("online", pull);
		};
	}, [enabled]);
	return [
		data ? { ...data, now, timeZone: zone, timeZoneLabel: zoneLabel } : null,
		store,
	];
}

export function App() {
	const injected = window.__SCHEDEE_SNAPSHOT__ ?? null;
	const [live, store] = useLiveSnapshot(!injected);
	const [theme, themeChoice, setThemeChoice] = useTheme();
	const snapshot = injected ?? live;
	if (!snapshot) return null;
	return (
		<Schedee
			snapshot={snapshot}
			theme={theme}
			{...(window.__SCHEDEE_SELECT__
				? { initialSelectedId: window.__SCHEDEE_SELECT__ }
				: {})}
			themeChoice={themeChoice}
			onTheme={setThemeChoice}
			{...(store && !injected
				? {
						onCommit: (r: EditResult) =>
							void store.commit(r).then((queued) => {
								if (queued) void syncAll(store);
							}),
						onCalendarVisibility: (id: string, hidden: boolean) =>
							void store.setCalendarHidden(id, hidden),
						onAddAccount: () =>
							void addGoogleAccount(store).catch((e: unknown) =>
								console.warn("Adding the Google account failed:", e),
							),
					}
				: {})}
			{...(window.__SCHEDEE_SCROLL_TOP__ === undefined
				? {}
				: { scrollTop: window.__SCHEDEE_SCROLL_TOP__ })}
		/>
	);
}
