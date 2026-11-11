import {
	type Calendar,
	type EventInstance,
	formatDuration,
	Temporal,
} from "@schedee/core";
import { ArrowLeft, TextSearch, X } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { chipColors, type Theme } from "./chipColors";
import { formatRange } from "./format";

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export interface SearchFieldProps {
	query: string;
	onQuery: (q: string) => void;
	inputRef?: RefObject<HTMLInputElement | null>;
}

/** The context panel's search box. Escape leaves the field and keeps the query. */
export function SearchField({ query, onQuery, inputRef }: SearchFieldProps) {
	return (
		<div className="sch-search">
			<TextSearch className="sch-icon" size={18} strokeWidth={1.5} />
			<input
				ref={inputRef}
				className="sch-search__input"
				value={query}
				placeholder="Search events"
				aria-label="Search events"
				onChange={(e) => onQuery(e.target.value)}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Escape") e.currentTarget.blur();
				}}
			/>
			{query && (
				<button
					type="button"
					className="sch-iconbtn sch-search__clear"
					aria-label="Clear search"
					onClick={() => onQuery("")}
				>
					<X size={16} strokeWidth={1.5} className="sch-icon" />
				</button>
			)}
		</div>
	);
}

/** Header link back to the results, shown while an event opened from search is in the panel. */
export function BackToSearch({ onBack }: { onBack: () => void }) {
	return (
		<button
			type="button"
			className="sch-search__back"
			aria-label="Back to search"
			onClick={onBack}
		>
			<ArrowLeft size={18} strokeWidth={1.5} className="sch-icon" />
			<span>Search</span>
		</button>
	);
}

export interface SearchResultsProps {
	results: EventInstance[];
	now: Temporal.PlainDateTime;
	calendars: Map<string, Calendar>;
	theme: Theme;
	onPick: (e: EventInstance) => void;
}

const dayLabel = (d: Temporal.PlainDate, today: Temporal.PlainDate) => {
	const diff = today.until(d, { largestUnit: "days" }).days;
	if (diff === 0) return "Today";
	if (diff === 1) return "Tomorrow";
	const base = `${WEEKDAY[d.dayOfWeek - 1]} ${MONTH[d.month - 1]} ${d.day}`;
	return d.year === today.year ? base : `${base}, ${d.year}`;
};

const minutesOf = (iso: string) => {
	const t = Temporal.PlainDateTime.from(iso);
	return t.hour * 60 + t.minute;
};

/** Matches grouped by day, oldest first, opened scrolled to today. */
export function SearchResults({
	results,
	now,
	calendars,
	theme,
	onPick,
}: SearchResultsProps) {
	const today = now.toPlainDate();
	const list = useRef<HTMLDivElement>(null);
	const todayRow = useRef<HTMLLIElement>(null);

	const groups = new Map<string, EventInstance[]>();
	for (const r of results) {
		const key = r.start.slice(0, 10);
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	// Today always gets a heading, so there is somewhere to land between past and future.
	if (results.length && !groups.has(today.toString()))
		groups.set(today.toString(), []);
	const days = [...groups.keys()].sort();
	const resultKey = results.map((r) => r.id).join();

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-anchor when the results change
	useLayoutEffect(() => {
		const el = list.current;
		const row = todayRow.current;
		if (el && row) el.scrollTop = row.offsetTop - 4;
	}, [resultKey]);

	if (!results.length)
		return (
			<div className="sch-results">
				<div className="sch-results__empty">No results</div>
			</div>
		);

	return (
		<div className="sch-results" ref={list}>
			<ul>
				{days.map((key) => {
					const d = Temporal.PlainDate.from(key);
					const isToday = d.equals(today);
					const items = groups.get(key) ?? [];
					return [
						<li
							key={key}
							ref={isToday ? todayRow : undefined}
							className={`sch-results__day${isToday ? " sch-results__day--today" : ""}${items.length ? "" : " sch-results__day--empty"}`}
						>
							{dayLabel(d, today)}
						</li>,
						...items.map((e) => {
							const cal = calendars.get(e.calendarId);
							const { bar } = chipColors(
								cal?.color ?? "#B3B4B4",
								cal?.colorDark,
								theme,
								false,
							);
							const end = e.allDay
								? Temporal.PlainDate.from(e.end).toPlainDateTime()
								: Temporal.PlainDateTime.from(e.end);
							const past = Temporal.PlainDateTime.compare(end, now) <= 0;
							const length = e.allDay
								? 0
								: Temporal.PlainDateTime.from(e.start).until(end, {
										largestUnit: "minutes",
									}).minutes;
							return (
								<li key={e.id}>
									<button
										type="button"
										className={`sch-result${past ? " sch-result--past" : ""}`}
										onClick={() => onPick(e)}
									>
										<span
											className="sch-result__bar"
											style={{ background: bar }}
										/>
										<span className="sch-result__text">
											<span className="sch-result__title">
												{e.title || "(No title)"}
											</span>
											<span className="sch-result__time">
												{e.allDay
													? "All day"
													: formatRange(minutesOf(e.start), minutesOf(e.end))}
												{length > 0 && (
													<span className="sch-result__length">
														{" "}
														{formatDuration(length)}
													</span>
												)}
											</span>
										</span>
									</button>
								</li>
							);
						}),
					];
				})}
			</ul>
		</div>
	);
}
