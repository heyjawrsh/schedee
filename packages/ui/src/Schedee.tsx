import {
	applyCalendarChange,
	applyDelete,
	applyDuplicate,
	applyEdit,
	applyMove,
	applyResult,
	type Calendar,
	type CalendarEvent,
	type CalendarSnapshot,
	type EditResult,
	type EventInstance,
	expandEvents,
	goTo,
	initialView,
	invertEdit,
	newEventId,
	searchEvents,
	setView,
	step,
	Temporal,
	type ViewState,
	viewLabel,
	visibleDays,
	weekOf,
} from "@schedee/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CommandMenu } from "./CommandMenu";
import { ContextPanel } from "./ContextPanel";
import type { Theme } from "./chipColors";
import { buildCommands, type ThemeChoice } from "./commands";
import { DaysView } from "./DaysView";
import { EventPanel } from "./EventPanel";
import { Header } from "./Header";
import { MonthView } from "./MonthView";
import { BackToSearch, SearchField, SearchResults } from "./Search";
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

/** How far back and ahead search looks for occurrences of repeating events. */
const SEARCH_YEARS_BACK = 5;
const SEARCH_YEARS_AHEAD = 2;
/** Undo depth. */
const HISTORY = 100;

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
	/** The saved theme preference, for the command menu. */
	themeChoice?: ThemeChoice;
	onTheme?: (t: ThemeChoice) => void;
	/** Hide or show a calendar. Without it the command menu leaves calendars out. */
	onCalendarVisibility?: (calendarId: string, hidden: boolean) => void;
	/** Start connecting a Google account. Without it the menu doesn't offer one. */
	onAddAccount?: () => void;
	/** Sign an account in again after its sign-in expired. */
	onReconnect?: (accountId: string) => void;
	/** Remove a synced account from this device. Without it the menu doesn't offer to. */
	onRemoveAccount?: (accountId: string) => void;
	/** Subscribe to an ICS feed. Without it the menu doesn't offer to. */
	onSubscribeFeed?: (url: string) => void;
	/** Remove a feed subscription. */
	onUnsubscribeFeed?: (calendarId: string) => void;
	/** Clear an account's "changes weren't saved" notice. */
	onDismissDropped?: (accountId: string) => void;
}

/** The app frame: sidebar, main view (day, N days, week or month) and context panel. */
export function Schedee({
	snapshot,
	theme,
	scrollTop,
	initialState,
	onCommit,
	initialSelectedId,
	themeChoice,
	onTheme,
	onCalendarVisibility,
	onAddAccount,
	onReconnect,
	onRemoveAccount,
	onSubscribeFeed,
	onUnsubscribeFeed,
	onDismissDropped,
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
	// Commits show at once; the overlay drops when the store sends back new events.
	const [optimistic, setOptimistic] = useState<{
		base: CalendarEvent[];
		events: CalendarEvent[];
	} | null>(null);
	const events =
		optimistic?.base === snapshot.events ? optimistic.events : snapshot.events;
	const eventsRef = useRef(events);
	eventsRef.current = events;

	const instances = useMemo(
		() =>
			expandEvents(
				events,
				{ start: first, end: last.add({ days: 1 }) },
				snapshot.timeZone,
			),
		[events, snapshot.timeZone, first, last],
	);

	const past = useRef<{ forward: EditResult; back: EditResult }[]>([]);
	const future = useRef<{ forward: EditResult; back: EditResult }[]>([]);
	const send = (r: EditResult) => {
		if (!onCommit) return;
		const current = eventsRef.current;
		const next = applyResult(current, r);
		eventsRef.current = next;
		setOptimistic({ base: snapshot.events, events: next });
		onCommit(r);
	};
	/** Commits an edit and records it for undo. */
	const commit = (r: EditResult) => {
		if (!onCommit) return;
		past.current.push({ forward: r, back: invertEdit(eventsRef.current, r) });
		if (past.current.length > HISTORY) past.current.shift();
		future.current = [];
		send(r);
	};
	const undo = () => {
		const entry = past.current.pop();
		if (!entry) return;
		future.current.push(entry);
		send(entry.back);
	};
	const redo = () => {
		const entry = future.current.pop();
		if (!entry) return;
		past.current.push(entry);
		send(entry.forward);
	};

	const [selectedId, setSelectedId] = useState<string | null>(
		initialSelectedId ?? null,
	);
	const selected = instances.find((i) => i.id === selectedId) ?? null;
	const selectedCal = selected ? calendars.get(selected.calendarId) : undefined;
	const writable = useMemo(
		() => [...calendars.values()].filter((c) => !c.subscribed),
		[calendars],
	);
	/** Subscribed calendars and events someone else organizes can't be changed here. */
	const canEdit = (i: EventInstance) => {
		const cal = calendars.get(i.calendarId);
		return (
			!!onCommit &&
			!!cal &&
			!cal.subscribed &&
			!i.attendees?.some((a) => a.organizer && !a.self)
		);
	};
	const readOnly = !selected || !canEdit(selected);
	const defaultCalendar =
		writable.find((c) => c.isDefault && !c.hidden) ?? writable[0];
	const [focusTitle, setFocusTitle] = useState<string | null>(null);

	const duplicate = (i: EventInstance, start?: string, end?: string) => {
		const id = newEventId(i.calendarId);
		commit(applyDuplicate(i, id, start, end));
		setSelectedId(id);
	};
	const create = (start: string, end: string) => {
		if (!defaultCalendar) return;
		const id = newEventId(defaultCalendar.id);
		commit({
			put: [
				{
					id,
					calendarId: defaultCalendar.id,
					title: "",
					start,
					end,
					allDay: false,
					timeZone: snapshot.timeZone,
				},
			],
			remove: [],
		});
		setSelectedId(id);
		setFocusTitle(id);
	};

	/** A one-hour event from the next quarter hour today, or 9 AM on the first visible day. */
	const createNow = () => {
		const showsToday = days.some((d) => d.equals(today));
		const next = Math.ceil((now.hour * 60 + now.minute + 1) / 15) * 15;
		const start = showsToday
			? today.toPlainDateTime().add({ minutes: next })
			: first.toPlainDateTime({ hour: 9 });
		create(start.toString(), start.add({ hours: 1 }).toString());
	};
	const canCreate = !!onCommit && !!defaultCalendar;

	// Search: the query lives here so results survive opening an event from them.
	const [query, setQuery] = useState("");
	const searchInput = useRef<HTMLInputElement>(null);
	const [focusSearch, setFocusSearch] = useState(0);
	useEffect(() => {
		if (focusSearch) searchInput.current?.focus();
	}, [focusSearch]);
	const startSearch = (q?: string) => {
		setSelectedId(null);
		if (q !== undefined) setQuery(q);
		setFocusSearch((n) => n + 1);
	};
	const results = useMemo(
		() =>
			query.trim()
				? searchEvents(
						events,
						query,
						{
							start: today.subtract({ years: SEARCH_YEARS_BACK }),
							end: today.add({ years: SEARCH_YEARS_AHEAD }),
						},
						snapshot.timeZone,
					)
				: [],
		[events, query, today, snapshot.timeZone],
	);

	const [menu, setMenu] = useState<{ start?: string } | null>(null);
	const commands = buildCommands({
		view,
		today,
		setView: setViewState,
		search: () => startSearch(),
		createEvent: canCreate ? createNow : undefined,
		calendars: [...calendars.values()],
		onCalendarVisibility,
		onAddAccount,
		signedOut: snapshot.accounts.filter((a) => a.problem === "signed_out"),
		onReconnect,
		removable: snapshot.accounts.filter((a) => a.provider === "google"),
		onRemoveAccount,
		onSubscribeFeed,
		feeds: snapshot.accounts
			.filter((a) => a.provider === "ics")
			.flatMap((a) => a.calendars),
		onUnsubscribeFeed,
		theme: themeChoice,
		onTheme,
	});

	// Keyboard actions read the latest render through this ref.
	const actions = useRef({
		selected,
		readOnly,
		undo,
		redo,
		duplicate,
		commit,
		createNow: canCreate ? createNow : null,
		query,
		startSearch,
	});
	actions.current = {
		query,
		startSearch,
		selected,
		readOnly,
		undo,
		redo,
		duplicate,
		commit,
		createNow: canCreate ? createNow : null,
	};

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
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setMenu((m) => (m ? null : {}));
				return;
			}
			if (isTyping(e.target)) return;
			const k = e.key.toLowerCase();
			const a = actions.current;
			if (e.key === "Escape") {
				// First the open event, then the search.
				if (a.selected) setSelectedId(null);
				else if (a.query) setQuery("");
				return;
			}
			if ((e.metaKey || e.ctrlKey) && !e.altKey) {
				if (k === "f") {
					e.preventDefault();
					a.startSearch();
					return;
				}
				if (k === "z" || k === "y") {
					e.preventDefault();
					if (k === "y" || e.shiftKey) a.redo();
					else a.undo();
				} else if (k === "d" && a.selected && !a.readOnly) {
					e.preventDefault();
					a.duplicate(a.selected);
				}
				return;
			}
			if ((e.key === "Backspace" || e.key === "Delete") && a.selected) {
				// Even when the event can't be deleted, Backspace mustn't navigate the page back.
				e.preventDefault();
				if (a.readOnly) return;
				a.commit(applyDelete(eventsRef.current, a.selected));
				setSelectedId(null);
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const update = (f: (v: ViewState) => ViewState) => {
				e.preventDefault();
				setViewState(f);
			};
			if (k === "d" || k === "1") update((v) => setView(v, "day"));
			else if (k === "w" || k === "0") update((v) => setView(v, "week"));
			else if (k === "m") update((v) => setView(v, "month"));
			else if (/^[2-9]$/.test(k)) update((v) => setView(v, "days", Number(k)));
			else if (k === "t") update((v) => goTo(v, today));
			else if (k === "c" && a.createNow) {
				e.preventDefault();
				a.createNow();
			} else if (k === ".") {
				e.preventDefault();
				setMenu({ start: "goto-date" });
			} else if (k === "/") {
				e.preventDefault();
				a.startSearch();
			} else if (k === "j" || k === "arrowright") update((v) => step(v, 1));
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
				onReconnect={onReconnect}
				onDismissDropped={onDismissDropped}
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
						canEdit={canEdit}
						onMove={(i, start, end, copy) =>
							copy
								? duplicate(i, start, end)
								: commit(applyMove(eventsRef.current, i, start, end))
						}
						onCreate={onCommit && defaultCalendar ? create : undefined}
						newCalendarId={defaultCalendar?.id}
					/>
				)}
			</main>
			<ContextPanel
				header={
					selected ? (
						query.trim() ? (
							<BackToSearch onBack={() => setSelectedId(null)} />
						) : null
					) : (
						<SearchField
							query={query}
							onQuery={setQuery}
							inputRef={searchInput}
						/>
					)
				}
			>
				{selected ? (
					<EventPanel
						key={selected.id}
						instance={selected}
						calendar={selectedCal}
						writable={writable}
						readOnly={readOnly}
						theme={theme}
						focusTitle={focusTitle === selected.id}
						onChange={(patch, scope) => {
							const { calendarId } = patch;
							if (calendarId && calendarId !== selected.calendarId) {
								// Ids carry their calendar, so a calendar change is a move.
								const r = applyCalendarChange(
									eventsRef.current,
									selected,
									calendarId,
								);
								commit({ put: r.put, remove: r.remove });
								setSelectedId(r.id);
								return;
							}
							commit(applyEdit(eventsRef.current, selected, patch, scope));
						}}
						onDelete={(scope) => {
							commit(applyDelete(eventsRef.current, selected, scope));
							setSelectedId(null);
						}}
					/>
				) : query.trim() ? (
					<SearchResults
						results={results}
						now={now}
						calendars={calendars}
						theme={theme}
						onPick={(e) => {
							setViewState((v) =>
								goTo(v, Temporal.PlainDate.from(e.start.slice(0, 10))),
							);
							setSelectedId(e.id);
						}}
					/>
				) : undefined}
			</ContextPanel>
			{menu && (
				<CommandMenu
					groups={commands}
					startWith={menu.start}
					onClose={() => setMenu(null)}
					onSearch={startSearch}
				/>
			)}
		</div>
	);
}
