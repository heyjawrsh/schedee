import type { CalendarSnapshot } from "@schedee/core";
import { Schedee, type Theme } from "@schedee/ui";
import { useEffect, useState } from "react";
import { demoSnapshot } from "./demo";

declare global {
	interface Window {
		/** Injected by the fidelity harness and tests. */
		__SCHEDEE_SNAPSHOT__?: CalendarSnapshot | null;
		__SCHEDEE_THEME__?: Theme;
		__SCHEDEE_SCROLL_TOP__?: number;
	}
}

const systemTheme = (): Theme =>
	matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export function App() {
	const [snapshot] = useState(
		() => window.__SCHEDEE_SNAPSHOT__ ?? demoSnapshot(),
	);
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
