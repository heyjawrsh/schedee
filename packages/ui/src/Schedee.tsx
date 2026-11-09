import {
	type Calendar,
	type CalendarSnapshot,
	expandEvents,
	goTo,
	initialView,
	setView,
	step,
	Temporal,
	type ViewState,
	viewLabel,
	visibleDays,
	weekOf,
} from "@schedee/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContextPanel } from "./ContextPanel";
import type { Theme } from "./chipColors";
import { DaysView } from "./DaysView";
import { Header } from "./Header";
import { MonthView } from "./MonthView";
import { Sidebar } from "./Sidebar";

/** Main-area size, measured before paint so the first frame is already laid out. */
function useSize(fallback: { width: number; height: number }) {
	const ref = useRef<HTMLElement>(null);
	const [size, setSize] = useState(fallback);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const read = () =>
			setSize({ width: el.clientWidth, height: el.clientHeight });
		read();
		const ro = new ResizeObserver(read);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return [ref, size] as const;
}

const isTyping = (t: EventTarget | null) =>
	t instanceof HTMLElement &&
	(t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export interface SchedeeProps {
	snapshot: CalendarSnapshot;
	theme: Theme;
	/** Initial grid scroll in px; defaults to bringing "now" into view. */
	scrollTop?: number;
	initialState?: ViewState;
}

/** The app frame: sidebar, main view (day, N days, week or month) and context panel. */
export function Schedee({
	snapshot,
	theme,
	scrollTop,
	initialState,
}: SchedeeProps) {
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);
	const now = Temporal.PlainDateTime.from(snapshot.now);
	const today = now.toPlainDate();
	const [view, setViewState] = useState<ViewState>(
		() => initialState ?? initialView(today),
	);
	const [mainRef, size] = useSize({ width: 916, height: 900 });

	const calendars = useMemo(
		() =>
			new Map<string, Calendar>(
				snapshot.accounts.flatMap((a) => a.calendars.map((c) => [c.id, c])),
			),
		[snapshot.accounts],
	);
	const days = visibleDays(view);
	const first = days[0] ?? today;
	const last = days.at(-1) ?? today;
	const instances = useMemo(
		() =>
			expandEvents(
				snapshot.events,
				{ start: first, end: last.add({ days: 1 }) },
				snapshot.timeZone,
			),
		[snapshot.events, snapshot.timeZone, first, last],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			const k = e.key.toLowerCase();
			const update = (f: (v: ViewState) => ViewState) => {
				e.preventDefault();
				setViewState(f);
			};
			if (k === "d" || k === "1") update((v) => setView(v, "day"));
			else if (k === "w" || k === "0") update((v) => setView(v, "week"));
			else if (k === "m") update((v) => setView(v, "month"));
			else if (/^[2-9]$/.test(k)) update((v) => setView(v, "days", Number(k)));
			else if (k === "t") update((v) => goTo(v, today));
			else if (k === "j" || k === "arrowright") update((v) => step(v, 1));
			else if (k === "k" || k === "arrowleft") update((v) => step(v, -1));
		};
		addEventListener("keydown", onKey);
		return () => removeEventListener("keydown", onKey);
	}, [today]);

	const titleDate = view.kind === "month" ? view.anchor : first;
	return (
		<div className="sch-app" data-schedee-ready data-view={view.kind}>
			<Sidebar
				accounts={snapshot.accounts}
				today={today}
				theme={theme}
				focus={view.anchor}
				{...(view.kind === "month" ? {} : { band: weekOf(first).start })}
				onPickDate={(d) => setViewState((v) => goTo(v, d))}
			/>
			<main className="sch-main" ref={mainRef}>
				<Header
					viewLabel={viewLabel(view)}
					month={titleDate.month}
					year={titleDate.year}
					{...(view.kind === "month"
						? { vertical: true }
						: { week: first.weekOfYear ?? 0 })}
					onToday={() => setViewState((v) => goTo(v, today))}
					onStep={(dir) => setViewState((v) => step(v, dir))}
					onView={(kind, count) => setViewState((v) => setView(v, kind, count))}
				/>
				{view.kind === "month" ? (
					<MonthView
						days={days}
						month={view.anchor.month}
						width={size.width}
						height={size.height}
						events={instances}
						calendars={calendars}
						now={now}
						theme={theme}
						onPickDay={(d) => setViewState((v) => goTo(setView(v, "day"), d))}
					/>
				) : (
					<DaysView
						days={days}
						width={size.width}
						events={instances}
						calendars={calendars}
						now={now}
						timeZoneLabel={snapshot.timeZoneLabel}
						theme={theme}
						{...(scrollTop === undefined ? {} : { scrollTop })}
					/>
				)}
			</main>
			<ContextPanel />
		</div>
	);
}
