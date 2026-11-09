import { type CalendarSnapshot, Temporal } from "@schedee/core";
import { Schedee, type Theme } from "@schedee/ui";
import { useEffect, useState } from "react";
import { demoSeed } from "./demo";
import { createLocalStore } from "./store/db";

declare global {
	interface Window {
		/** Injected by the fidelity harness and tests: render this static snapshot instead of the store. */
		__SCHEDEE_SNAPSHOT__?: CalendarSnapshot | null;
		__SCHEDEE_THEME__?: Theme;
		__SCHEDEE_SCROLL_TOP__?: number;
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

function useTheme(): Theme {
	const [theme, setTheme] = useState<Theme>(
		() => window.__SCHEDEE_THEME__ ?? systemTheme(),
	);
	useEffect(() => {
		if (window.__SCHEDEE_THEME__) return;
		const mq = matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => setTheme(systemTheme());
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return theme;
}

/** Live data: the local store, plus a clock that ticks every 30 seconds. */
function useLiveSnapshot(enabled: boolean): CalendarSnapshot | null {
	const [data, setData] = useState<Pick<
		CalendarSnapshot,
		"accounts" | "events"
	> | null>(null);
	const [now, setNow] = useState(nowIso);
	useEffect(() => {
		if (!enabled) return;
		const store = createLocalStore(demoSeed);
		const off = store.subscribe(setData);
		const tick = setInterval(() => setNow(nowIso()), 30_000);
		return () => {
			off();
			clearInterval(tick);
		};
	}, [enabled]);
	return data
		? { ...data, now, timeZone: zone, timeZoneLabel: zoneLabel }
		: null;
}

export function App() {
	const injected = window.__SCHEDEE_SNAPSHOT__ ?? null;
	const live = useLiveSnapshot(!injected);
	const theme = useTheme();
	const snapshot = injected ?? live;
	if (!snapshot) return null;
	return (
		<Schedee
			snapshot={snapshot}
			theme={theme}
			{...(window.__SCHEDEE_SCROLL_TOP__ === undefined
				? {}
				: { scrollTop: window.__SCHEDEE_SCROLL_TOP__ })}
		/>
	);
}
