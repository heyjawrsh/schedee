import {
	applyDelete,
	applyEdit,
	type Calendar,
	type CalendarSnapshot,
	type EditResult,
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
import { EventPanel } from "./EventPanel";
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
	/** Persist an edit. Without it the calendar is read-only. */
	onCommit?: (result: EditResult) => void;
	initialSelectedId?: string;
}

/** The app frame: sidebar, main view (day, N days, week or month) and context panel. */
export function Schedee({
	snapshot,
	theme,
	scrollTop,
	initialState,
	onCommit,
	initialSelectedId,
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

	const [selectedId, setSelectedId] = useState<string | null>(
		initialSelectedId ?? null,
	);
	const selected = instances.find((i) => i.id === selectedId) ?? null;
	const selectedCal = selected ? calendars.get(selected.calendarId) : undefined;
	const writable = useMemo(
		() => [...calendars.values()].filter((c) => !c.subscribed),
		[calendars],
	);
	const readOnly =
		!onCommit ||
		!selectedCal ||
		!!selectedCal.subscribed ||
		!!selected?.attendees?.some((a) => a.organizer && !a.self);

	// A press on empty calendar space clears the selection (chips stop their own presses).
	useEffect(() => {
		const onDown = (e: PointerEvent) => {
			const t = e.target as Element | null;
			if (t?.closest(".sch-main") && !t.closest("[data-event-id]"))
				setSelectedId(null);
		};
		addEventListener("pointerdown", onDown);
		return () => removeEventListener("pointerdown", onDown);
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !isTyping(e.target)) {
				setSelectedId(null);
				return;
			}
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
						selectedId={selectedId ?? undefined}
						onSelect={setSelectedId}
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
						selectedId={selectedId ?? undefined}
						onSelect={setSelectedId}
					/>
				)}
			</main>
			<ContextPanel>
				{selected && (
					<EventPanel
						key={selected.id}
						instance={selected}
						calendar={selectedCal}
						writable={writable}
						readOnly={readOnly}
						theme={theme}
						onChange={(patch, scope) =>
							onCommit?.(applyEdit(snapshot.events, selected, patch, scope))
						}
						onDelete={(scope) => {
							onCommit?.(applyDelete(snapshot.events, selected, scope));
							setSelectedId(null);
						}}
					/>
				)}
			</ContextPanel>
		</div>
	);
}
