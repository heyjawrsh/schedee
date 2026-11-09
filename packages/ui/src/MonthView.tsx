import {
	type Calendar,
	type CalendarEvent,
	type EventInstance,
	layoutAllDay,
	Temporal,
} from "@schedee/core";
import type { CSSProperties } from "react";
import { chipColors, type Theme } from "./chipColors";
import { formatTime } from "./format";
import { GiftGlyph } from "./GiftGlyph";
import { monthName } from "./Header";

// Month geometry measured from the reference (1440x900 @2x). CSS px.
const WEEKNUM_COL = 24;
const GRID_TOP = 107;
const CELL_PAD_TOP = 28;
const SLOT = 21;
const CHIP_H = 19;
const CHIP_LEFT = 2;
const CHIP_RIGHT = 13.5;
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface MonthViewProps {
	/** 42 days, starting on the week start. */
	days: Temporal.PlainDate[];
	month: number;
	width: number;
	height?: number;
	events: EventInstance[];
	calendars: Map<string, Calendar>;
	now: Temporal.PlainDateTime;
	theme: Theme;
	onPickDay?: (d: Temporal.PlainDate) => void;
}

const vars = (bar: string, bg: string, title: string, time: string) =>
	({
		"--chip-bar": bar,
		"--chip-bg": bg,
		"--chip-title": title,
		"--chip-time": time,
	}) as CSSProperties;

export function MonthView({
	days,
	month,
	width,
	height = 900,
	events,
	calendars,
	now,
	theme,
	onPickDay,
}: MonthViewProps) {
	const today = now.toPlainDate();
	const colW = (width - WEEKNUM_COL + 0.5) / 7;
	const rowH = (height - GRID_TOP) / 6;
	const maxSlots = Math.max(1, Math.floor((rowH - CELL_PAD_TOP - SLOT) / SLOT));
	const visible = events.filter((e) => !calendars.get(e.calendarId)?.hidden);
	const colorsOf = (e: CalendarEvent, past: boolean) => {
		const c = calendars.get(e.calendarId);
		return chipColors(c?.color ?? "#B3B4B4", c?.colorDark, theme, past);
	};
	const isPast = (e: CalendarEvent) =>
		Temporal.PlainDateTime.compare(
			e.allDay
				? Temporal.PlainDate.from(e.end).toPlainDateTime()
				: Temporal.PlainDateTime.from(e.end),
			now,
		) <= 0;

	const weeks = Array.from({ length: 6 }, (_, w) =>
		days.slice(w * 7, w * 7 + 7),
	);
	return (
		<>
			<div className="sch-dayhead">
				<div className="sch-month__wlabel">W</div>
				{WEEKDAY.map((d, i) => (
					<div
						key={d}
						className={`sch-dayhead__cell${today.dayOfWeek === i + 1 ? " sch-dayhead__cell--todayname" : ""}`}
						style={{ left: WEEKNUM_COL + i * colW, width: colW }}
					>
						{d}
					</div>
				))}
			</div>
			<div className="sch-month" style={{ top: GRID_TOP }}>
				<div className="sch-month__weeknums" style={{ width: WEEKNUM_COL }} />
				{weeks.map((wk, w) => {
					const top = w * rowH;
					const first = wk[0];
					if (!first) return null;
					const allDay = layoutAllDay(
						visible.filter((e) => e.allDay),
						wk,
					);
					// Per-day: all-day slots taken, then timed events into the free slots.
					const perDay = wk.map((d, i) => {
						const taken = new Set(
							allDay
								.filter((p) => p.startCol <= i && i < p.startCol + p.span)
								.map((p) => p.row),
						);
						const timed = visible
							.filter(
								(e) =>
									!e.allDay &&
									Temporal.PlainDate.from(e.start.slice(0, 10)).equals(d),
							)
							.sort((a, b) => a.start.localeCompare(b.start));
						const total = taken.size + timed.length;
						const limit = total > maxSlots + 1 ? maxSlots : maxSlots + 1;
						const slots: { slot: number; e: EventInstance }[] = [];
						let s = 0;
						for (const e of timed) {
							while (taken.has(s)) s++;
							slots.push({ slot: s, e });
							s++;
						}
						const shown = slots.filter((x) => x.slot < limit);
						const hiddenAllDay = [...taken].filter((r) => r >= limit).length;
						return {
							d,
							i,
							limit,
							shown,
							more: total - shown.length - (taken.size - hiddenAllDay),
						};
					});
					return (
						<div
							key={first.toString()}
							className="sch-month__row"
							style={{ top, height: rowH }}
						>
							<div className="sch-month__wn">{first.weekOfYear}</div>
							{wk.map((d, i) => {
								const isToday = d.equals(today);
								const out = d.month !== month;
								return (
									<button
										type="button"
										key={d.toString()}
										className={`sch-month__cell${d.dayOfWeek >= 6 ? " sch-month__cell--weekend" : ""}`}
										style={{ left: WEEKNUM_COL + i * colW, width: colW }}
										onClick={() => onPickDay?.(d)}
										aria-label={d.toString()}
									>
										<span
											className={`sch-month__num${out ? " sch-month__num--out" : ""}${d.day === 1 ? " sch-month__num--first" : ""}`}
										>
											{d.day === 1 && <b>{monthName(d.month)}</b>}
											{isToday ? (
												<span className="sch-badge">{d.day}</span>
											) : (
												d.day
											)}
										</span>
									</button>
								);
							})}
							{allDay.map((p) => {
								const fits = perDay
									.slice(p.startCol, p.startCol + p.span)
									.every((x) => p.row < x.limit);
								if (!fits) return null;
								const c = colorsOf(p.event, isPast(p.event));
								return (
									<div
										key={p.event.id}
										className="sch-chip sch-chip--allday"
										style={{
											...vars(c.bar, c.bg, c.title, c.time),
											top: CELL_PAD_TOP + p.row * SLOT,
											left: WEEKNUM_COL + p.startCol * colW + CHIP_LEFT,
											width: p.span * colW - CHIP_LEFT - CHIP_RIGHT,
											height: CHIP_H,
										}}
									>
										{p.event.glyph === "gift" && <GiftGlyph />}
										<span className="sch-chip__title">{p.event.title}</span>
									</div>
								);
							})}
							{perDay.map(({ i, shown, more, limit }) => (
								<div key={`slots${i}`}>
									{shown.map(({ slot, e }) => {
										const past = isPast(e);
										const c = colorsOf(e, past);
										const t = Temporal.PlainDateTime.from(e.start);
										return (
											<div
												key={e.id}
												className={`sch-mitem${past ? " sch-mitem--past" : ""}`}
												style={{
													...vars(c.bar, c.bg, c.title, c.time),
													top: CELL_PAD_TOP + slot * SLOT,
													left: WEEKNUM_COL + i * colW + CHIP_LEFT,
													width: colW - CHIP_LEFT - CHIP_RIGHT,
												}}
											>
												<span className="sch-mitem__time">
													{formatTime(t.hour * 60 + t.minute)}
												</span>
												<span className="sch-mitem__title">{e.title}</span>
											</div>
										);
									})}
									{more > 0 && (
										<div
											className="sch-month__more"
											style={{
												top: CELL_PAD_TOP + limit * SLOT,
												left: WEEKNUM_COL + i * colW + 10,
											}}
										>
											{more} more
										</div>
									)}
								</div>
							))}
						</div>
					);
				})}
			</div>
		</>
	);
}
