import {
	type Calendar,
	type CalendarEvent,
	type EventInstance,
	layoutAllDay,
	layoutDay,
	Temporal,
	type TimedPlacement,
} from "@schedee/core";
import { ChevronsDownUp, Diff, Plus } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { type ChipColors, chipColors, type Theme } from "./chipColors";
import {
	DRAG_SLOP,
	type DragState,
	type GridPoint,
	proposal,
	segments,
	unchanged,
} from "./drag";
import { formatRange, formatTime, hourParts, nowParts } from "./format";
import { GiftGlyph } from "./GiftGlyph";
import {
	ALLDAY_CHIP,
	ALLDAY_INSET,
	ALLDAY_MAX,
	ALLDAY_ROW,
	CHIP_COMPACT_BELOW,
	CHIP_MARGIN_BOTTOM,
	CHIP_MARGIN_RIGHT,
	CHIP_MIN_HEIGHT,
	HEADER_HEIGHT,
	PX_PER_MIN,
	RIBBON_GAP,
	RIBBON_WIDTH,
} from "./geometry";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** x of the first day column inside the main area. */
const COL0 = 71.5;
const ALLDAY_TOP = HEADER_HEIGHT + 28;
/** Hours that get a line and a gutter label (midnight's line is the all-day border). */
const HOURS = Array.from({ length: 23 }, (_, k) => k + 1);

export interface DaysViewProps extends Selectable {
	/** The day columns to show, in order. */
	days: Temporal.PlainDate[];
	/** Width of the main area; day columns share it. */
	width: number;
	events: EventInstance[];
	calendars: Map<string, Calendar>;
	now: Temporal.PlainDateTime;
	timeZoneLabel: string;
	theme: Theme;
	scrollTop?: number;
	/** Whether an instance can be moved or resized. Nothing is draggable without it. */
	canEdit?: ((e: EventInstance) => boolean) | undefined;
	/** A drag finished: move or resize to `start`/`end`, or place a copy there. */
	onMove?:
		| ((e: EventInstance, start: string, end: string, copy: boolean) => void)
		| undefined;
	/** A drag on empty grid finished. Without it the grid does not create events. */
	onCreate?: ((start: string, end: string) => void) | undefined;
	/** Calendar whose colours a new event previews in. */
	newCalendarId?: string | undefined;
}

const chipVars = (c: ChipColors) =>
	({
		"--chip-bg": c.bg,
		"--chip-bar": c.bar,
		"--chip-title": c.title,
		"--chip-time": c.time,
	}) as CSSProperties;

function colorsFor(
	e: CalendarEvent,
	calendars: Map<string, Calendar>,
	theme: Theme,
	past: boolean,
) {
	const cal = calendars.get(e.calendarId);
	return chipColors(cal?.color ?? "#B3B4B4", cal?.colorDark, theme, past);
}

interface Selectable {
	selectedId?: string | undefined;
	onSelect?: ((id: string) => void) | undefined;
}

type Press = (e: React.PointerEvent, id: string) => void;

/** Empty grid inside a day column, not a chip or the gutter. */
const onGrid = (t: Element) =>
	!!t.closest(".sch-col") && !t.closest("[data-event-id]");

/**
 * A press selects (and may start a drag through `onPress`); the handlers stop the event so the grid
 * behind never sees it.
 */
const selectProps = (
	id: string,
	{ selectedId, onSelect }: Selectable,
	onPress?: Press,
) => ({
	"data-event-id": id,
	"aria-selected": selectedId === id,
	onPointerDown: (e: React.PointerEvent) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		onSelect?.(id);
		onPress?.(e, id);
	},
	onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
	onClick: (e: React.MouseEvent) => e.stopPropagation(),
});

/** How a chip is drawn: in place, as the dimmed original of a drag, or as the drag preview. */
type ChipVariant = "ghost" | "drag" | "resize";
const VARIANT_CLASS: Record<ChipVariant, string> = {
	ghost: " sch-chip--selected sch-chip--ghost",
	drag: " sch-chip--selected sch-chip--drag",
	resize: " sch-chip--selected sch-chip--resize",
};
/** The moving copy is drawn a little shorter than the slot its ring outlines. */
const DRAG_SHRINK = 3;
/** Resize handles need room left over for moving. */
const HANDLES_MIN_HEIGHT = 16;

const UNTITLED = "(No title)";

function TimedChip({
	p,
	x,
	areaWidth,
	colors,
	sel,
	variant,
	editable = false,
	onPress,
}: {
	p: TimedPlacement;
	x: number;
	areaWidth: number;
	colors: ChipColors;
	sel: Selectable;
	variant?: ChipVariant | undefined;
	editable?: boolean;
	onPress?: Press | undefined;
}) {
	const preview = variant === "drag" || variant === "resize";
	const height = Math.max(
		CHIP_MIN_HEIGHT,
		(p.endMin - p.startMin) * PX_PER_MIN -
			CHIP_MARGIN_BOTTOM -
			(variant === "drag" ? DRAG_SHRINK : 0),
	);
	const compact = height < CHIP_COMPACT_BELOW;
	const selected = sel.selectedId === p.event.id;
	const style: CSSProperties = {
		...chipVars(colors),
		top: p.startMin * PX_PER_MIN,
		left: x + p.left * areaWidth,
		width: p.width * areaWidth - CHIP_MARGIN_RIGHT,
		height,
		zIndex: preview ? 45 : selected ? 40 : 10 + p.z,
	};
	const classes =
		(p.event.rsvp === "tentative" && !preview ? " sch-chip--hatched" : "") +
		(variant ? VARIANT_CLASS[variant] : selected ? " sch-chip--selected" : "");
	const props = preview
		? { "aria-hidden": true }
		: selectProps(p.event.id, sel, editable ? onPress : undefined);
	const handles = editable && !preview && height >= HANDLES_MIN_HEIGHT && (
		<>
			<div className="sch-chip__handle" data-handle="start" />
			<div
				className="sch-chip__handle sch-chip__handle--end"
				data-handle="end"
			/>
		</>
	);
	const title = p.event.title || UNTITLED;
	if (compact) {
		return (
			<div
				className={`sch-chip sch-chip--compact${classes}`}
				style={style}
				{...props}
			>
				<span className="sch-chip__title">{title}</span>
				{height < ALLDAY_ROW && (
					<span className="sch-chip__time">{formatTime(p.startMin)}</span>
				)}
				{handles}
			</div>
		);
	}
	const lines = Math.max(1, Math.floor((height - 4 - 13) / 13));
	return (
		<div className={`sch-chip${classes}`} style={style} {...props}>
			<div className="sch-chip__title" style={{ WebkitLineClamp: lines }}>
				{p.event.rsvp === "needsAction" && !preview && (
					<span className="sch-chip__dot" />
				)}
				{title}
			</div>
			<div className="sch-chip__time">{formatRange(p.startMin, p.endMin)}</div>
			{handles}
		</div>
	);
}

/** Chips beside a ribbon cut one continuous gap per run of touching or overlapping chips, clipped to the ribbon. */
function mergeCuts(
	chips: TimedPlacement[],
	ribbon: TimedPlacement,
): [number, number][] {
	const spans = chips
		.map(
			(c) =>
				[
					Math.max(c.startMin, ribbon.startMin),
					Math.min(c.endMin, ribbon.endMin),
				] as [number, number],
		)
		.sort((a, b) => a[0] - b[0]);
	const out: [number, number][] = [];
	for (const [s, e] of spans) {
		const last = out.at(-1);
		if (last && s <= last[1]) last[1] = Math.max(last[1], e);
		else out.push([s, e]);
	}
	return out;
}

function Ribbon({
	p,
	x,
	colors,
	cuts,
}: {
	p: TimedPlacement;
	x: number;
	colors: ChipColors;
	cuts: TimedPlacement[];
}) {
	const top = p.startMin * PX_PER_MIN;
	const height = (p.endMin - p.startMin) * PX_PER_MIN - CHIP_MARGIN_BOTTOM;
	const variant =
		p.event.rsvp === "needsAction"
			? " sch-ribbon--pending"
			: p.event.rsvp === "tentative"
				? " sch-ribbon--hatched"
				: "";
	return (
		<div
			className={`sch-ribbon${variant}`}
			style={{ ...chipVars(colors), top, left: x, height }}
		>
			{variant !== " sch-ribbon--pending" &&
				mergeCuts(cuts, p).map(([start, end]) => (
					<div
						key={start}
						className="sch-ribbon__cut"
						style={{
							top: start * PX_PER_MIN - top,
							height: Math.min(
								height,
								(end - start) * PX_PER_MIN - CHIP_MARGIN_BOTTOM,
							),
						}}
					/>
				))}
		</div>
	);
}

export function DaysView({
	days,
	width,
	events,
	calendars,
	now,
	timeZoneLabel,
	theme,
	scrollTop,
	selectedId,
	onSelect,
	canEdit,
	onMove,
	onCreate,
	newCalendarId,
}: DaysViewProps) {
	const sel: Selectable = { selectedId, onSelect };
	const inner = useRef<HTMLDivElement>(null);
	const grid = useRef<HTMLDivElement>(null);
	const [drag, setDragState] = useState<DragState | null>(null);
	const dragRef = useRef<DragState | null>(null);
	const setDrag = useCallback((d: DragState | null) => {
		dragRef.current = d;
		setDragState(d);
	}, []);
	const today = now.toPlainDate();
	const dayWidth = (width - COL0 + 2.5) / days.length;
	const lastDay = days.at(-1) ?? today;
	const visible = events.filter((e) => !calendars.get(e.calendarId)?.hidden);
	const nowMin = now.hour * 60 + now.minute + now.second / 60;
	const nowY = nowMin * PX_PER_MIN;
	const isPast = (e: CalendarEvent) =>
		Temporal.PlainDateTime.compare(
			e.allDay
				? Temporal.PlainDate.from(e.end).toPlainDateTime()
				: Temporal.PlainDateTime.from(e.end),
			now,
		) <= 0;

	const showsToday = days.some((d) => d.equals(today));
	const allDay = layoutAllDay(visible, days);
	const rows = allDay.reduce((m, p) => Math.max(m, p.row + 1), 0);
	const allDayHeight = Math.min(
		ALLDAY_MAX,
		ALLDAY_INSET + rows * ALLDAY_ROW + 1,
	);
	const gridTop = ALLDAY_TOP + allDayHeight;
	const gridHeight = 900 - gridTop;
	const scroll =
		scrollTop ??
		Math.max(0, Math.min(1152 - gridHeight, nowY - gridHeight / 3));

	// Opens scrolled to just before now (or where the caller asks); after that, the user scrolls.
	const firstScroll = useRef(scroll);
	useLayoutEffect(() => {
		if (grid.current) grid.current.scrollTop = firstScroll.current;
	}, []);

	const columns = (render: (d: Temporal.PlainDate, i: number) => ReactNode) =>
		days.map((d, i) => (
			<div
				key={d.toString()}
				className={`sch-col${d.dayOfWeek >= 6 ? " sch-col--weekend" : ""}`}
				style={{ left: COL0 + i * dayWidth, width: dayWidth }}
			>
				{render(d, i)}
			</div>
		));

	/** Client coordinates to a day column and minutes from midnight. */
	const point = (x: number, y: number): GridPoint | null => {
		const r = inner.current?.getBoundingClientRect();
		if (!r) return null;
		const col = Math.floor((x - r.left - COL0) / dayWidth);
		return {
			col: Math.max(0, Math.min(days.length - 1, col)),
			min: (y - r.top) / PX_PER_MIN,
		};
	};
	const byId = new Map(visible.map((e) => [e.id, e]));
	const pressChip: Press = (e, id) => {
		const event = byId.get(id);
		if (!event || event.allDay || !onMove || !canEdit?.(event)) return;
		const at = point(e.clientX, e.clientY);
		if (!at) return;
		const handle = (e.target as HTMLElement).dataset.handle;
		setDrag({
			mode:
				handle === "start" || handle === "end"
					? handle
					: e.altKey
						? "copy"
						: "move",
			event,
			from: at,
			to: at,
			x0: e.clientX,
			y0: e.clientY,
			active: false,
		});
	};
	const pressGrid = (e: PointerEvent) => {
		const t = e.target as Element;
		if (e.button !== 0 || !onCreate || !onGrid(t)) return;
		const at = point(e.clientX, e.clientY);
		if (!at) return;
		setDrag({
			mode: "create",
			from: at,
			to: at,
			x0: e.clientX,
			y0: e.clientY,
			active: false,
		});
	};
	const createAt = (e: MouseEvent) => {
		const at = point(e.clientX, e.clientY);
		const d = at && days[at.col];
		if (!d || !onCreate || !onGrid(e.target as Element)) return;
		const start = d
			.toPlainDateTime()
			.add({ minutes: Math.min(23 * 60, Math.floor(at.min / 15) * 15) });
		onCreate(start.toString(), start.add({ hours: 1 }).toString());
	};

	// Latest values for the window listeners below, which live for the whole drag.
	const latest = useRef({
		point,
		days,
		onMove,
		onCreate,
		pressGrid,
		createAt,
	});
	latest.current = { point, days, onMove, onCreate, pressGrid, createAt };
	// Native listeners: the grid is not a control, so it takes no React handlers.
	useEffect(() => {
		const el = inner.current;
		if (!el) return;
		const down = (e: PointerEvent) => latest.current.pressGrid(e);
		const dbl = (e: MouseEvent) => latest.current.createAt(e);
		el.addEventListener("pointerdown", down);
		el.addEventListener("dblclick", dbl);
		return () => {
			el.removeEventListener("pointerdown", down);
			el.removeEventListener("dblclick", dbl);
		};
	}, []);
	const dragging = drag !== null;
	useEffect(() => {
		if (!dragging) return;
		const move = (e: PointerEvent) => {
			const d = dragRef.current;
			const at = latest.current.point(e.clientX, e.clientY);
			if (!d || !at) return;
			const active =
				d.active || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > DRAG_SLOP;
			setDrag({ ...d, to: at, active });
		};
		const up = () => {
			const d = dragRef.current;
			setDrag(null);
			if (!d?.active) return;
			const { days, onMove, onCreate } = latest.current;
			const p = proposal(d, days);
			if (!p) return;
			if (d.mode === "create") onCreate?.(p.start.toString(), p.end.toString());
			else if (d.event && (d.mode === "copy" || !unchanged(p, d.event)))
				onMove?.(
					d.event,
					p.start.toString(),
					p.end.toString(),
					d.mode === "copy",
				);
		};
		const cancel = () => setDrag(null);
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopImmediatePropagation();
			cancel();
		};
		addEventListener("pointermove", move);
		addEventListener("pointerup", up);
		addEventListener("pointercancel", cancel);
		addEventListener("keydown", key, true);
		return () => {
			removeEventListener("pointermove", move);
			removeEventListener("pointerup", up);
			removeEventListener("pointercancel", cancel);
			removeEventListener("keydown", key, true);
		};
	}, [dragging, setDrag]);

	const active = drag?.active ? drag : null;
	const cursor =
		active?.mode === "copy"
			? "copy"
			: active?.mode === "start" ||
					active?.mode === "end" ||
					active?.mode === "create"
				? "row-resize"
				: "";
	useEffect(() => {
		document.documentElement.style.cursor = cursor;
		return () => {
			document.documentElement.style.cursor = "";
		};
	}, [cursor]);

	const landing = active && proposal(active, days);
	const previewEvent: EventInstance | null =
		landing &&
		(active.event
			? {
					...active.event,
					start: landing.start.toString(),
					end: landing.end.toString(),
				}
			: newCalendarId
				? {
						id: "new",
						sourceId: "new",
						calendarId: newCalendarId,
						title: "",
						start: landing.start.toString(),
						end: landing.end.toString(),
						allDay: false,
					}
				: null);
	const previewSegs = landing && previewEvent ? segments(landing, days) : [];
	const ghostId = active?.event?.id;
	const previewKind =
		active?.mode === "move" || active?.mode === "copy" ? "drag" : "resize";

	return (
		<>
			<div className="sch-dayhead">
				<button
					type="button"
					className="sch-iconbtn"
					style={{ left: 3, top: 4, width: 20, height: 20 }}
					aria-label="New event"
				>
					<Plus size={12} strokeWidth={1.75} className="sch-icon" />
				</button>
				<div className="sch-tz">{timeZoneLabel}</div>
				{days.map((d, i) => {
					const isToday = d.equals(today);
					return (
						<div
							key={d.toString()}
							className={`sch-dayhead__cell${isToday ? " sch-dayhead__cell--today" : ""}`}
							style={{ left: COL0 + i * dayWidth, width: dayWidth }}
						>
							<span>{WEEKDAY[d.dayOfWeek - 1]}</span>
							{isToday ? (
								<span className="sch-badge">{d.day}</span>
							) : (
								<span>{d.day}</span>
							)}
						</div>
					);
				})}
				<button
					type="button"
					className="sch-iconbtn"
					style={{ right: 2, top: 6, width: 16, height: 16 }}
					aria-label="Days shown"
				>
					<Diff size={12} strokeWidth={1.75} className="sch-icon" />
				</button>
			</div>

			<div className="sch-allday" style={{ height: allDayHeight }}>
				<div className="sch-allday__gutter" />
				{columns(() => null)}
				<button
					type="button"
					className="sch-iconbtn"
					style={{ left: 48.6, top: 2.5, width: 20, height: 20 }}
					aria-label="Collapse all-day"
				>
					<ChevronsDownUp size={14} strokeWidth={1.5} className="sch-icon" />
				</button>
				{allDay.map((p) => (
					<div
						key={p.event.id}
						className={`sch-chip sch-chip--allday${selectedId === p.event.id ? " sch-chip--selected" : ""}`}
						{...selectProps(p.event.id, sel)}
						style={{
							...chipVars(
								colorsFor(p.event, calendars, theme, isPast(p.event)),
							),
							top: ALLDAY_INSET + p.row * ALLDAY_ROW,
							left: COL0 + p.startCol * dayWidth,
							// Events that run past the last visible day reach the edge.
							width:
								p.span * dayWidth -
								(Temporal.PlainDate.compare(
									Temporal.PlainDate.from(p.event.end),
									lastDay.add({ days: 1 }),
								) > 0
									? 0
									: CHIP_MARGIN_RIGHT),
							height: ALLDAY_CHIP,
						}}
					>
						{p.event.glyph === "gift" && <GiftGlyph />}
						<span className="sch-chip__title">{p.event.title}</span>
					</div>
				))}
			</div>

			<div className="sch-grid" ref={grid} style={{ top: gridTop }}>
				<div ref={inner} className="sch-grid__inner">
					<div className="sch-gutter" style={{ top: 0, height: 1152 }}>
						{Array.from({ length: 23 }, (_, k) => {
							const [h, mer] = hourParts(k + 1);
							return (
								<div
									key={h + mer}
									className="sch-hour"
									style={{ top: (k + 1) * 48 - 6.5 }}
								>
									{h}
									<span>{mer}</span>
								</div>
							);
						})}
						{
							<div
								className={`sch-nowlabel${showsToday ? "" : " sch-nowlabel--bare"}`}
								style={{ top: nowY - 9 }}
							>
								{nowParts(nowMin)[0]}
								<span>{nowParts(nowMin)[1]}</span>
							</div>
						}
					</div>
					{columns((d, i) => {
						const placed = layoutDay(visible, d);
						const ribbons = placed.filter((p) => p.kind === "ribbon");
						const chips = placed.filter((p) => p.kind === "chip");
						return (
							<>
								{HOURS.map((h) => (
									<div
										key={h}
										className="sch-hourline"
										style={{ top: h * 48 }}
									/>
								))}
								{ribbons.map((r) => (
									<Ribbon
										key={r.event.id}
										p={r}
										x={0}
										colors={colorsFor(
											r.event,
											calendars,
											theme,
											isPast(r.event),
										)}
										cuts={chips.filter(
											(c) =>
												c.besideRibbon &&
												c.startMin < r.endMin &&
												r.startMin < c.endMin,
										)}
									/>
								))}
								{chips.map((c) => {
									const offset = c.besideRibbon ? RIBBON_WIDTH + RIBBON_GAP : 0;
									const event = c.event as EventInstance;
									return (
										<TimedChip
											key={c.event.id}
											p={c}
											x={offset}
											areaWidth={dayWidth - offset}
											colors={colorsFor(
												c.event,
												calendars,
												theme,
												isPast(c.event),
											)}
											sel={sel}
											variant={ghostId === c.event.id ? "ghost" : undefined}
											editable={!!onMove && !!canEdit?.(event)}
											onPress={pressChip}
										/>
									);
								})}
								{previewEvent &&
									previewSegs
										.filter((g) => g.col === i)
										.map((g) => {
											const colors = colorsFor(
												previewEvent,
												calendars,
												theme,
												false,
											);
											return (
												<div key={`preview${g.startMin}`}>
													{previewKind === "drag" && (
														<div
															className="sch-dropring"
															style={{
																...chipVars(colors),
																top: g.startMin * PX_PER_MIN,
																height: (g.endMin - g.startMin) * PX_PER_MIN,
																width: dayWidth,
															}}
														/>
													)}
													<TimedChip
														p={{
															event: previewEvent,
															startMin: g.startMin,
															endMin: g.endMin,
															kind: "chip",
															left: 0,
															width: 1,
															besideRibbon: false,
															z: 0,
														}}
														x={0}
														areaWidth={dayWidth}
														colors={colors}
														sel={sel}
														variant={previewKind}
													/>
												</div>
											);
										})}
								{showsToday && (
									<div className="sch-nowline" style={{ top: nowY - 0.5 }} />
								)}
								{d.equals(today) && (
									<div
										className="sch-nowline sch-nowline--today"
										style={{ top: nowY - 1 }}
									/>
								)}
							</>
						);
					})}
				</div>
			</div>
		</>
	);
}
