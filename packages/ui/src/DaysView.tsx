import {
	type Calendar,
	type CalendarEvent,
	layoutAllDay,
	layoutDay,
	Temporal,
	type TimedPlacement,
} from "@schedee/core";
import { ChevronsDownUp, Diff, Plus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { type ChipColors, chipColors, type Theme } from "./chipColors";
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

export interface DaysViewProps {
	/** The day columns to show, in order. */
	days: Temporal.PlainDate[];
	/** Width of the main area; day columns share it. */
	width: number;
	events: CalendarEvent[];
	calendars: Map<string, Calendar>;
	now: Temporal.PlainDateTime;
	timeZoneLabel: string;
	theme: Theme;
	scrollTop?: number;
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

function TimedChip({
	p,
	x,
	areaWidth,
	colors,
}: {
	p: TimedPlacement;
	x: number;
	areaWidth: number;
	colors: ChipColors;
}) {
	const height = Math.max(
		CHIP_MIN_HEIGHT,
		(p.endMin - p.startMin) * PX_PER_MIN - CHIP_MARGIN_BOTTOM,
	);
	const compact = height < CHIP_COMPACT_BELOW;
	const style: CSSProperties = {
		...chipVars(colors),
		top: p.startMin * PX_PER_MIN,
		left: x + p.left * areaWidth,
		width: p.width * areaWidth - CHIP_MARGIN_RIGHT,
		height,
		zIndex: 10 + p.z,
	};
	const hatched = p.event.rsvp === "tentative" ? " sch-chip--hatched" : "";
	if (compact) {
		return (
			<div className={`sch-chip sch-chip--compact${hatched}`} style={style}>
				<span className="sch-chip__title">{p.event.title}</span>
				{height < ALLDAY_ROW && (
					<span className="sch-chip__time">{formatTime(p.startMin)}</span>
				)}
			</div>
		);
	}
	const lines = Math.max(1, Math.floor((height - 4 - 13) / 13));
	return (
		<div className={`sch-chip${hatched}`} style={style}>
			<div className="sch-chip__title" style={{ WebkitLineClamp: lines }}>
				{p.event.rsvp === "needsAction" && <span className="sch-chip__dot" />}
				{p.event.title}
			</div>
			<div className="sch-chip__time">{formatRange(p.startMin, p.endMin)}</div>
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
}: DaysViewProps) {
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

	const columns = (render: (d: Temporal.PlainDate) => ReactNode) =>
		days.map((d, i) => (
			<div
				key={d.toString()}
				className={`sch-col${d.dayOfWeek >= 6 ? " sch-col--weekend" : ""}`}
				style={{ left: COL0 + i * dayWidth, width: dayWidth }}
			>
				{render(d)}
			</div>
		));

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
						className="sch-chip sch-chip--allday"
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

			<div className="sch-grid" style={{ top: gridTop }}>
				<div
					className="sch-grid__inner"
					style={{ transform: `translateY(${-scroll}px)` }}
				>
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
					{columns((d) => {
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
										/>
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
